import "server-only";
import type { CameraPatch, NewEvent, PolledCamera, PollerStore } from "./poller";
import type { RawStatus, TimelineEvent } from "./status-rules";

// Prisma dimuat saat dipakai agar mode mock tidak membutuhkan DATABASE_URL.
async function db() {
    return (await import("@/lib/prisma")).default;
}

const raw = (status: string): RawStatus => (status === "OFFLINE" ? "OFFLINE" : status === "UNKNOWN" ? "UNKNOWN" : "ONLINE");

export class PrismaPollerStore implements PollerStore {
    async listActiveAccountIds(): Promise<string[]> {
        const rows = await (await db()).ezvizAccount.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
        return rows.map((r) => r.id);
    }

    async listCameras(accountId: string): Promise<PolledCamera[]> {
        const rows = await (await db()).camera.findMany({
            where: { store: { contractor: { ezvizAccount: { id: accountId } } } },
            orderBy: [{ storeId: "asc" }, { label: "asc" }],
        });
        return rows.map((c) => ({
            id: c.id,
            deviceSerial: c.deviceSerial,
            channelNo: c.channelNo,
            status: c.status,
            statusSince: c.statusSince,
            sdStatus: c.sdStatus,
            sdCheckedAt: c.sdCheckedAt,
            snapshotAt: c.snapshotAt,
            snapshotTriedAt: c.snapshotTriedAt,
        }));
    }

    async eventsSince(cameraId: string, since: Date): Promise<TimelineEvent[]> {
        const prisma = await db();
        const [before, after] = await Promise.all([
            prisma.cameraEvent.findFirst({
                where: { cameraId, createdAt: { lt: since } },
                orderBy: { createdAt: "desc" },
            }),
            prisma.cameraEvent.findMany({
                where: { cameraId, createdAt: { gte: since } },
                orderBy: { createdAt: "asc" },
            }),
        ]);
        return [...(before ? [before] : []), ...after].map((e) => ({ status: raw(e.status), at: e.createdAt }));
    }

    async addEvent(cameraId: string, event: NewEvent): Promise<void> {
        await (await db()).cameraEvent.create({
            data: { cameraId, status: event.status, sdStatus: event.sdStatus, note: event.note, createdAt: event.at },
        });
    }

    async updateCamera(cameraId: string, patch: CameraPatch): Promise<void> {
        await (await db()).camera.update({ where: { id: cameraId }, data: patch });
    }
}
