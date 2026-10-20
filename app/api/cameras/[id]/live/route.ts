import { getDataSource, getGateway } from "@/lib/cameras";
import { isGatewayError } from "@/lib/cameras/errors";
import type { RecordingRange } from "@/lib/cameras/gateway";
import { wibDateKey } from "@/lib/ezviz/time";
import {
    checkCapacity,
    denialMessage,
    maxLiveSessions,
    type CapacityDenial,
    type LiveQuality,
} from "@/lib/live-limiter";
import { addLiveSeconds, liveSecondsOf } from "@/lib/live-usage";
import { getCameraDetail } from "@/lib/monitoring";

const LIVE_EXPIRE_SECONDS = 3 * 60; // 3 menit, sesuai auto-stop di UI
// Sesi ezopen yang belum memutar frame pertama. Diperpanjang ke LIVE_EXPIRE_SECONDS oleh PATCH
// dari klien saat video tampil; bila player gagal dan klien tidak sempat DELETE, kamera lain
// pada akun yang sama hanya terblokir selama ini. Cukup longgar untuk kamera baterai yang bangun.
const PENDING_EXPIRE_SECONDS = 60;

// "ezopen" (bawaan): player EZUIKit di browser. Satu-satunya cara yang terbukti jalan untuk kamera
// baterai/4G seperti EZVIZ EB8 — HLS/RTMP/FLV standar hanya menghasilkan "/ErrCode/6520|9053".
// "hls": alamat HLS lewat proxy server (token tidak sampai ke browser), untuk kamera bertenaga listrik.
function liveProtocol(): "ezopen" | "hls" {
    return process.env.LIVE_PROTOCOL === "hls" ? "hls" : "ezopen";
}

type Prisma = (typeof import("@/lib/prisma"))["default"];

// ?begin=<ISO>&end=<ISO> → playback rekaman MicroSD. Rentang harus di hari WIB yang sama (syarat
// EZUIKit) dan sudah dimulai. Tanpa keduanya → live.
function parsePlayback(params: URLSearchParams): RecordingRange | null | "invalid" {
    const begin = params.get("begin");
    const end = params.get("end");
    if (!begin && !end) return null;
    const start = new Date(begin ?? "");
    const stop = new Date(end ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) return "invalid";
    if (start >= stop || start.getTime() > Date.now()) return "invalid";
    if (wibDateKey(start) !== wibDateKey(new Date(stop.getTime() - 1000))) return "invalid";
    return { start, end: stop };
}

// Tutup sesi terbuka kamera ini (semua, atau hanya `sessionId`) dan catat detik pemakaiannya.
async function closeSessions(prisma: Prisma, accountId: string, cameraId: string, sessionId?: string) {
    const now = new Date();
    const open = await prisma.liveSession.findMany({
        where: { cameraId, endedAt: null, ...(sessionId ? { id: sessionId } : {}) },
    });
    if (open.length === 0) return;
    await prisma.liveSession.updateMany({ where: { id: { in: open.map((s) => s.id) } }, data: { endedAt: now } });
    const seconds = open.reduce((sum, s) => sum + liveSecondsOf(s, now), 0);
    await addLiveSeconds(accountId, seconds, now).catch((e) => console.error("[live] catat usage gagal:", e));
}

// Pesan slot sesi untuk kamera ini secara atomik: kunci per akun (advisory lock) agar beberapa POST
// bersamaan dari grid multi-live tidak lolos pengecekan yang sama. Sesi lama kamera ini ditutup.
// Sesi dibuat berstatus pending; pemanggil memperbarui (HLS) atau membiarkan PATCH memperpanjangnya.
async function reserveSession(
    prisma: Prisma,
    input: { accountId: string; cameraId: string; quality: LiveQuality; expiresAt: Date },
): Promise<{ sessionId: string } | { denial: CapacityDenial; max: number }> {
    const max = maxLiveSessions();
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.accountId}))`;
        const open = await tx.liveSession.findMany({ where: { accountId: input.accountId, endedAt: null } });
        const denial = checkCapacity(open, input.cameraId, now, { max, quality: input.quality });
        if (denial) return { ok: false as const, denial };
        const replaced = open.filter((s) => s.cameraId === input.cameraId);
        if (replaced.length > 0) {
            await tx.liveSession.updateMany({
                where: { id: { in: replaced.map((s) => s.id) } },
                data: { endedAt: now },
            });
        }
        const session = await tx.liveSession.create({
            data: {
                accountId: input.accountId,
                cameraId: input.cameraId,
                quality: input.quality,
                expiresAt: input.expiresAt,
            },
        });
        const replacedSeconds = replaced.reduce((sum, s) => sum + liveSecondsOf(s, now), 0);
        return { ok: true as const, sessionId: session.id, replacedSeconds };
    });
    if (!result.ok) return { denial: result.denial, max };
    await addLiveSeconds(input.accountId, result.replacedSeconds, now).catch((e) =>
        console.error("[live] catat usage gagal:", e),
    );
    return { sessionId: result.sessionId };
}

// POST /api/cameras/[id]/live — mulai sesi live (atau playback MicroSD dengan ?begin=&end=).
// Live dan playback berbagi pembatas maks. N sesi per akun (LIVE_MAX_SESSIONS_PER_ACCOUNT),
// heartbeat PATCH, dan DELETE. Ditolak pembatas → 409 { error, code: "full" | "hd_busy" }.
// Balasan: { kind: "ezopen", url, accessToken, domain, expiresAt, sessionId } atau
// { kind: "hls", url, expiresAt, sessionId }. sessionId dipakai klien untuk DELETE ?session=.
// KEAMANAN (mode ezopen): accessToken akun kontraktor dikirim ke browser karena EZUIKit memerlukannya.
// Wajib di balik auth/proxy sebelum production (docs/ezviz-integration-plan.md §9); idealnya diganti
// token sub-akun (RAM) yang dibatasi ke perangkat ini.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const search = new URL(req.url).searchParams;
    // ?quality=1 (HD) atau 2 (sub-stream, bawaan); berguna untuk menguji kamera yang gagal di sub-stream.
    const quality: LiveQuality = search.get("quality") === "1" ? 1 : 2;
    const playback = parsePlayback(search);
    if (playback === "invalid") {
        return Response.json({ error: "Rentang waktu rekaman tidak valid" }, { status: 400 });
    }

    if (getDataSource() !== "ezviz") {
        return Response.json({ error: "Mode ezviz tidak aktif" }, { status: 503 });
    }

    const detail = await getCameraDetail(decodeURIComponent(id));
    if (!detail) return Response.json({ error: "Kamera tidak ditemukan" }, { status: 404 });

    const { camera, store } = detail;
    if (!store.ezvizAccount) {
        return Response.json({ error: "Kontraktor belum punya akun EZVIZ" }, { status: 409 });
    }
    if (camera.status === "OFFLINE") {
        return Response.json({ error: "Kamera offline" }, { status: 409 });
    }
    if (camera.status === "UNKNOWN") {
        return Response.json({ error: "Status kamera belum diketahui" }, { status: 409 });
    }
    // Heartbeat PATCH memperbarui alamat HLS sebagai live, jadi playback HLS belum didukung.
    if (liveProtocol() === "hls" && playback) {
        return Response.json({ error: "Playback hanya tersedia dengan player ezopen" }, { status: 501 });
    }

    const accountId = store.ezvizAccount.id;
    const ref = { accountId, deviceSerial: camera.deviceSerial, channelNo: camera.channelNo };
    const { default: prisma } = await import("@/lib/prisma");

    // Pembatas: maks. N sesi aktif per akun; HD hanya bila tidak ada kamera lain yang live.
    let sessionId: string | null = null;
    try {
        const reserved = await reserveSession(prisma, {
            accountId,
            cameraId: id,
            quality,
            // HLS: umur sesi diganti dengan umur alamat yang diminta sesudah ini.
            expiresAt: new Date(Date.now() + PENDING_EXPIRE_SECONDS * 1000),
        });
        if ("denial" in reserved) {
            return Response.json(
                { error: denialMessage(reserved.denial, reserved.max), code: reserved.denial },
                { status: 409 },
            );
        }
        sessionId = reserved.sessionId;
    } catch (dbErr) {
        console.error("[live] Gagal memeriksa pembatas / menyimpan LiveSession:", dbErr);
    }

    // Permintaan ke EZVIZ gagal → slot dilepas lagi (tanpa mencatat usage).
    const releaseSlot = async () => {
        if (sessionId) await prisma.liveSession.delete({ where: { id: sessionId } }).catch(() => {});
    };

    if (liveProtocol() === "ezopen") {
        try {
            const access = await getGateway().getPlayerAccess(ref, { quality, playback: playback ?? undefined });
            const expiresAt = new Date(Date.now() + PENDING_EXPIRE_SECONDS * 1000);
            return Response.json(
                { kind: "ezopen", ...access, expiresAt: expiresAt.toISOString(), sessionId },
                { headers: { "Cache-Control": "no-store" } },
            );
        } catch (error) {
            await releaseSlot();
            if (isGatewayError(error)) {
                const status = error.kind === "rate_limited" ? 429 : error.kind === "unsupported" ? 501 : 502;
                return Response.json({ error: error.message }, { status });
            }
            console.error("[live] getPlayerAccess error:", error);
            return Response.json({ error: "Gagal menyiapkan live" }, { status: 502 });
        }
    }

    try {
        const stream = await getGateway().startLive(ref, { expireSeconds: LIVE_EXPIRE_SECONDS, quality });

        // Simpan alamat HLS ke sesi (bukan in-memory, agar bisa diakses dari route /hls)
        if (sessionId) {
            await prisma.liveSession
                .update({
                    where: { id: sessionId },
                    data: { urlId: stream.id, hlsUrl: stream.url, expiresAt: stream.expiresAt },
                })
                .catch((dbErr) => console.error("[live] Gagal menyimpan alamat HLS:", dbErr));
        }

        // Kembalikan URL proxy ke browser (URL EZVIZ tidak dikirim ke klien)
        const appBase = process.env.APP_BASE_URL ?? "http://localhost:3005";
        const proxiedUrl = `${appBase}/api/cameras/${encodeURIComponent(id)}/hls`;
        return Response.json({
            kind: "hls",
            url: proxiedUrl,
            expiresAt: stream.expiresAt.toISOString(),
            streamId: stream.id,
            sessionId,
        });
    } catch (error) {
        await releaseSlot();
        if (isGatewayError(error)) {
            const status = error.kind === "offline" ? 409 : error.kind === "rate_limited" ? 429 : 502;
            return Response.json({ error: error.message }, { status });
        }
        console.error("[live] startLive error:", error);
        return Response.json({ error: "Gagal mendapatkan URL stream" }, { status: 502 });
    }
}

// DELETE /api/cameras/[id]/live[?session=<id>] — hentikan sesi live. Dengan ?session= hanya sesi
// itu yang ditutup, agar DELETE yang terlambat (mis. saat pindah tab live → playback) tidak ikut
// menutup sesi baru kamera yang sama.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const sessionId = new URL(req.url).searchParams.get("session") ?? undefined;

    if (getDataSource() !== "ezviz") {
        return new Response(null, { status: 204 });
    }

    try {
        const { default: prisma } = await import("@/lib/prisma");
        const sessions = await prisma.liveSession.findMany({
            where: { cameraId: id, endedAt: null, ...(sessionId ? { id: sessionId } : {}) },
        });

        const detail = await getCameraDetail(decodeURIComponent(id));
        if (detail && sessions.length > 0) {
            const ref = {
                accountId: detail.store.ezvizAccount?.id ?? null,
                deviceSerial: detail.camera.deviceSerial,
                channelNo: detail.camera.channelNo,
            };
            for (const session of sessions) {
                if (session.urlId) {
                    try {
                        await getGateway().stopLive(ref, session.urlId);
                    } catch {
                        // abaikan error stopLive; sesi tetap ditutup di DB
                    }
                }
            }
        }

        const accountId = detail?.store.ezvizAccount?.id ?? sessions[0]?.accountId;
        if (accountId) await closeSessions(prisma, accountId, id, sessionId);
    } catch (error) {
        console.error("[live] DELETE error:", error);
    }

    return new Response(null, { status: 204 });
}

// PATCH /api/cameras/[id]/live — heartbeat: ada interaksi pengguna, perpanjang sesi.
// Alamat EZVIZ berumur tetap, jadi perpanjangan = minta alamat baru; route /hls membaca
// alamat terbaru dari database sehingga pemutar tidak perlu dipasang ulang.
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (getDataSource() !== "ezviz") return new Response(null, { status: 204 });

    const cameraId = decodeURIComponent(id);
    const detail = await getCameraDetail(cameraId);
    const accountId = detail?.store.ezvizAccount?.id;
    if (!detail || !accountId) return Response.json({ error: "Kamera tidak ditemukan" }, { status: 404 });

    const { default: prisma } = await import("@/lib/prisma");
    const current = await prisma.liveSession.findFirst({
        where: { cameraId, endedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { startedAt: "desc" },
    });
    if (!current) return Response.json({ error: "Tidak ada sesi live aktif" }, { status: 404 });

    // ezopen: tidak ada alamat yang kedaluwarsa, cukup perpanjang sesi untuk pembatas & usage
    // (juga dipanggil sekali saat frame pertama tampil, mengubah sesi pending menjadi 3 menit).
    if (!current.urlId) {
        const expiresAt = new Date(Date.now() + LIVE_EXPIRE_SECONDS * 1000);
        await prisma.liveSession.update({ where: { id: current.id }, data: { expiresAt } });
        return Response.json({ expiresAt: expiresAt.toISOString() });
    }

    const ref = {
        accountId,
        deviceSerial: detail.camera.deviceSerial,
        channelNo: detail.camera.channelNo,
    };
    try {
        const stream = await getGateway().startLive(ref, {
            expireSeconds: LIVE_EXPIRE_SECONDS,
            quality: current.quality === 1 ? 1 : 2,
        });
        await prisma.liveSession.update({
            where: { id: current.id },
            data: { urlId: stream.id, hlsUrl: stream.url, expiresAt: stream.expiresAt },
        });
        if (current.urlId) await getGateway().stopLive(ref, current.urlId).catch(() => {});
        return Response.json({ expiresAt: stream.expiresAt.toISOString() });
    } catch (error) {
        console.error("[live] heartbeat error:", error);
        return Response.json({ error: "Gagal memperpanjang sesi" }, { status: 502 });
    }
}
