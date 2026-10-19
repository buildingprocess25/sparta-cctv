import { getDataSource, getGateway } from "@/lib/cameras";
import { isGatewayError } from "@/lib/cameras/errors";
import { addSnapshotCall } from "@/lib/live-usage";
import { getCameraDetail } from "@/lib/monitoring";
import { FsSnapshotStorage, readSnapshotFile, snapshotDir } from "@/lib/poller/snapshot-storage";

export const dynamic = "force-dynamic";

// Menyajikan snapshot terbaru kamera dari SNAPSHOT_DIR. Nama berkas diambil dari database
// (bukan dari URL), sehingga tidak ada path traversal.
// CATATAN: belum ada autentikasi — wajib dilindungi sebelum production (lihat docs/ezviz-integration-plan.md §9).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    if (getDataSource() === "mock") return new Response("Tidak ada snapshot pada mode mock", { status: 404 });

    const { id } = await params;
    const { default: prisma } = await import("@/lib/prisma");
    const camera = await prisma.camera.findUnique({ where: { id }, select: { snapshotPath: true } });
    if (!camera?.snapshotPath) return new Response("Snapshot belum tersedia", { status: 404 });

    const file = await readSnapshotFile(snapshotDir(), camera.snapshotPath);
    if (!file) return new Response("Snapshot belum tersedia", { status: 404 });

    return new Response(new Uint8Array(file.bytes), {
        headers: {
            "Content-Type": file.contentType,
            // Versi ditentukan lewat ?v=<waktu snapshot>, jadi aman di-cache sebentar.
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        },
    });
}

const SNAPSHOT_COOLDOWN_MS = 30_000; // maksimal 1 snapshot baru per kamera per 30 detik

// POST /api/cameras/[id]/snapshot — ambil snapshot baru dari kamera
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    if (getDataSource() !== "ezviz") {
        return Response.json({ error: "Mode ezviz tidak aktif" }, { status: 503 });
    }

    const { id } = await params;
    const cameraId = decodeURIComponent(id);
    const detail = await getCameraDetail(cameraId);
    if (!detail) return Response.json({ error: "Kamera tidak ditemukan" }, { status: 404 });
    const { camera, store } = detail;
    if (!store.ezvizAccount) {
        return Response.json({ error: "Kontraktor belum punya akun EZVIZ" }, { status: 409 });
    }
    if (camera.status === "OFFLINE" || camera.status === "UNKNOWN") {
        return Response.json({ error: "Kamera tidak dapat dijangkau" }, { status: 409 });
    }

    const { default: prisma } = await import("@/lib/prisma");
    const row = await prisma.camera.findUnique({ where: { id: cameraId }, select: { snapshotAt: true } });
    if (row?.snapshotAt && Date.now() - row.snapshotAt.getTime() < SNAPSHOT_COOLDOWN_MS) {
        const wait = Math.ceil((SNAPSHOT_COOLDOWN_MS - (Date.now() - row.snapshotAt.getTime())) / 1000);
        return Response.json({ error: `Tunggu ${wait} detik sebelum snapshot berikutnya` }, { status: 429 });
    }

    try {
        const image = await getGateway().captureSnapshot({
            accountId: store.ezvizAccount?.id ?? null,
            deviceSerial: camera.deviceSerial,
            channelNo: camera.channelNo,
        });
        const snapshotPath = await new FsSnapshotStorage(snapshotDir()).save(cameraId, image);
        const snapshotAt = new Date();
        await prisma.camera.update({ where: { id: cameraId }, data: { snapshotPath, snapshotAt } });
        if (store.ezvizAccount?.id) await addSnapshotCall(store.ezvizAccount.id).catch(() => {});
        return Response.json({ snapshotAt: snapshotAt.toISOString() });
    } catch (error) {
        if (isGatewayError(error)) {
            const status = error.kind === "offline" ? 409 : error.kind === "rate_limited" ? 429 : 502;
            return Response.json({ error: error.message }, { status });
        }
        console.error("[snapshot] capture error:", error);
        return Response.json({ error: "Gagal mengambil snapshot" }, { status: 502 });
    }
}
