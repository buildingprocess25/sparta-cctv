import type { CameraPatch, NewEvent, PolledCamera, PollerStore } from "./poller";
import type { TimelineEvent } from "./status-rules";

/** Implementasi dalam memori untuk tes. */
export class MemoryPollerStore implements PollerStore {
    readonly cameras = new Map<string, PolledCamera & { accountId: string; lastCheckedAt?: Date; disconnectsToday?: number; uptime7d?: number | null; snapshotPath?: string }>();
    readonly events = new Map<string, (NewEvent & { id: number })[]>();
    activeAccounts: string[] = [];
    private seq = 0;

    addCamera(accountId: string, camera: Partial<PolledCamera> & { id: string }) {
        this.cameras.set(camera.id, {
            accountId,
            deviceSerial: camera.id.toUpperCase(),
            channelNo: 1,
            status: "UNKNOWN",
            statusSince: null,
            sdStatus: "OK",
            sdCheckedAt: null,
            snapshotAt: null,
            snapshotTriedAt: null,
            ...camera,
        });
        if (!this.activeAccounts.includes(accountId)) this.activeAccounts.push(accountId);
    }

    async listActiveAccountIds() {
        return [...this.activeAccounts];
    }

    async listCameras(accountId: string): Promise<PolledCamera[]> {
        return [...this.cameras.values()].filter((c) => c.accountId === accountId).map((c) => ({ ...c }));
    }

    async eventsSince(cameraId: string, since: Date): Promise<TimelineEvent[]> {
        const all = (this.events.get(cameraId) ?? []).slice().sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
        const before = all.filter((e) => e.at < since);
        const after = all.filter((e) => e.at >= since);
        const predecessor = before.length ? [before[before.length - 1]] : [];
        return [...predecessor, ...after].map((e) => ({ status: e.status, at: e.at }));
    }

    async addEvent(cameraId: string, event: NewEvent) {
        const list = this.events.get(cameraId) ?? [];
        list.push({ ...event, id: ++this.seq });
        this.events.set(cameraId, list);
    }

    async updateCamera(cameraId: string, patch: CameraPatch) {
        const camera = this.cameras.get(cameraId);
        if (!camera) throw new Error(`kamera ${cameraId} tidak ada`);
        Object.assign(camera, patch);
    }
}
