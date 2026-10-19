import { getDataSource, getGateway } from "@/lib/cameras";
import { isGatewayError } from "@/lib/cameras/errors";
import type { PtzCommand, PtzMove } from "@/lib/cameras/gateway";
import { getCameraDetail } from "@/lib/monitoring";

const LIVE_EXPIRE_SECONDS = 3 * 60; // sama dengan route live: gerak PTZ dihitung sebagai interaksi
const MOVES: readonly PtzMove[] = ["up", "down", "left", "right"];

function parseCommand(body: unknown): PtzCommand | null {
    const b = (body ?? {}) as { action?: unknown; move?: unknown };
    if (b.action === "stop") return { action: "stop" };
    if (b.action === "start" && MOVES.includes(b.move as PtzMove)) return { action: "start", move: b.move as PtzMove };
    return null;
}

// POST /api/cameras/[id]/ptz — { action: "start", move: "up"|"down"|"left"|"right" } atau { action: "stop" }.
// Token akun tetap di server. Kamera terus bergerak sampai "stop", jadi klien wajib mengirim stop
// saat tombol dilepas.
// CATATAN: belum ada autentikasi — wajib dilindungi sebelum production (docs/ezviz-integration-plan.md §9).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (getDataSource() !== "ezviz") {
        return Response.json({ error: "Mode ezviz tidak aktif" }, { status: 503 });
    }

    const command = parseCommand(await req.json().catch(() => null));
    if (!command) return Response.json({ error: "Perintah PTZ tidak valid" }, { status: 400 });

    const { id } = await params;
    const cameraId = decodeURIComponent(id);
    const detail = await getCameraDetail(cameraId);
    if (!detail) return Response.json({ error: "Kamera tidak ditemukan" }, { status: 404 });
    const { camera, store } = detail;
    if (!store.ezvizAccount) {
        return Response.json({ error: "Kontraktor belum punya akun EZVIZ" }, { status: 409 });
    }
    if (command.action === "start" && (camera.status === "OFFLINE" || camera.status === "UNKNOWN")) {
        return Response.json({ error: "Kamera tidak dapat dijangkau" }, { status: 409 });
    }

    const ref = { accountId: store.ezvizAccount.id, deviceSerial: camera.deviceSerial, channelNo: camera.channelNo };
    try {
        await getGateway().ptz(ref, command);
    } catch (error) {
        if (isGatewayError(error)) {
            if (error.kind === "ptz_limit") {
                return Response.json({ error: "Kamera sudah di batas putar", limit: true }, { status: 409 });
            }
            const status =
                error.kind === "offline" ? 409
                : error.kind === "unsupported" ? 501
                : error.kind === "rate_limited" ? 429
                : 502;
            const message = error.kind === "unsupported" ? "Kamera ini tidak mendukung PTZ" : error.message;
            return Response.json({ error: message }, { status });
        }
        console.error("[ptz] error:", error);
        return Response.json({ error: "Gagal menggerakkan kamera" }, { status: 502 });
    }

    // Perpanjang sesi live ezopen yang sedang terbuka (pembatas & usage), seperti heartbeat. Sesi HLS
    // (urlId terisi) tidak disentuh: alamatnya berumur tetap dan hanya diperbarui oleh PATCH /live.
    if (command.action === "start") {
        try {
            const { default: prisma } = await import("@/lib/prisma");
            await prisma.liveSession.updateMany({
                where: { cameraId, urlId: null, endedAt: null, expiresAt: { gt: new Date() } },
                data: { expiresAt: new Date(Date.now() + LIVE_EXPIRE_SECONDS * 1000) },
            });
        } catch (dbErr) {
            console.error("[ptz] Gagal memperpanjang sesi live:", dbErr);
        }
    }

    return new Response(null, { status: 204 });
}
