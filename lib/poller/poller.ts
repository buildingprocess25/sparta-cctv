import { isGatewayError, type GatewayErrorKind } from "@/lib/cameras/errors";
import type { CameraGateway, DeviceCheck } from "@/lib/cameras/gateway";
import type { SdStatusValue } from "@/lib/ezviz/mappers";
import { startOfDayWib } from "@/lib/ezviz/time";
import { loadPollerConfig, type PollerConfig } from "./config";
import type { SnapshotStorage } from "./snapshot-storage";
import {
    computeUptime,
    countDisconnects,
    deriveStatus,
    rawOf,
    type DerivedStatus,
    type RawStatus,
    type TimelineEvent,
} from "./status-rules";

const MIN = 60_000;
const DAY = 86_400_000;

export type PolledCamera = {
    id: string;
    deviceSerial: string | null;
    channelNo: number;
    status: DerivedStatus;
    statusSince: Date | null;
    sdStatus: SdStatusValue;
    sdCheckedAt: Date | null;
    snapshotAt: Date | null;
    snapshotTriedAt: Date | null;
};

export type CameraPatch = Partial<{
    status: DerivedStatus;
    statusSince: Date;
    lastCheckedAt: Date;
    disconnectsToday: number;
    uptime7d: number | null;
    sdStatus: SdStatusValue;
    sdCheckedAt: Date;
    snapshotPath: string;
    snapshotAt: Date;
    snapshotTriedAt: Date;
}>;

export type NewEvent = { status: RawStatus; sdStatus: SdStatusValue; at: Date; note?: string };

export interface PollerStore {
    /** akun EZVIZ berstatus ACTIVE */
    listActiveAccountIds(): Promise<string[]>;
    /** kamera yang berada di akun tersebut (lewat toko → kontraktor) */
    listCameras(accountId: string): Promise<PolledCamera[]>;
    /** event terurut naik sejak `since`, didahului event terakhir sebelum `since` (bila ada) */
    eventsSince(cameraId: string, since: Date): Promise<TimelineEvent[]>;
    addEvent(cameraId: string, event: NewEvent): Promise<void>;
    updateCamera(cameraId: string, patch: CameraPatch): Promise<void>;
}

export type AccountPollResult = {
    accountId: string;
    checked: number;
    changed: number;
    snapshots: number;
    /** kegagalan tingkat akun (daftar perangkat tidak bisa diambil) */
    error: GatewayErrorKind | null;
    /** pengecekan MicroSD dihentikan karena batas panggilan EZVIZ */
    rateLimited: boolean;
};

export type PollDeps = {
    store: PollerStore;
    gateway: CameraGateway;
    snapshots: SnapshotStorage;
    config?: PollerConfig;
    now?: () => Date;
};

type Resolved = Required<Pick<PollDeps, "store" | "gateway" | "snapshots">> & { config: PollerConfig; now: () => Date };

function resolveDeps(deps: PollDeps): Resolved {
    return { ...deps, config: deps.config ?? loadPollerConfig(), now: deps.now ?? (() => new Date()) };
}

const due = (last: Date | null, intervalMin: number, now: Date) =>
    !last || now.getTime() - last.getTime() >= intervalMin * MIN;

/**
 * Satu siklus cek untuk satu akun: 1 panggilan daftar perangkat untuk semua kamera,
 * lalu MicroSD dan snapshot hanya bila sudah waktunya. Kamera diproses berurutan.
 */
export async function pollAccount(accountId: string, input: PollDeps): Promise<AccountPollResult> {
    const { store, gateway, snapshots, config, now: clock } = resolveDeps(input);
    const now = clock();
    const result: AccountPollResult = { accountId, checked: 0, changed: 0, snapshots: 0, error: null, rateLimited: false };

    const cameras = (await store.listCameras(accountId)).filter((c) => c.deviceSerial);
    if (cameras.length === 0) return result;

    let checks: DeviceCheck[];
    try {
        checks = await gateway.checkAccountDevices(accountId);
    } catch (error) {
        if (!isGatewayError(error)) throw error;
        // Gagal sementara / akun bermasalah: status kamera dibiarkan apa adanya (jangan mengarang offline).
        result.error = error.kind;
        return result;
    }
    const bySerial = new Map(checks.map((c) => [c.deviceSerial, c]));
    const dayStart = startOfDayWib(now);

    let sdBlocked = false;
    let snapshotBlocked = false;

    for (const camera of cameras) {
        const check = bySerial.get(camera.deviceSerial!);
        const raw: RawStatus = check ? check.connection : "UNKNOWN";
        const prevRaw = rawOf(camera.status);
        const connectionChanged = raw !== prevRaw;
        const ref = { accountId, deviceSerial: camera.deviceSerial, channelNo: camera.channelNo };

        // ---- MicroSD (hanya saat online dan sudah waktunya) ----
        let sdStatus = camera.sdStatus;
        let sdCheckedAt = camera.sdCheckedAt;
        if (raw === "ONLINE" && !sdBlocked && (connectionChanged || due(camera.sdCheckedAt, config.sdCheckIntervalMin, now))) {
            try {
                const value = await gateway.getSdStatus(ref);
                if (value) sdStatus = value; // null = tidak dilaporkan → pertahankan
                sdCheckedAt = now;
            } catch (error) {
                if (!isGatewayError(error)) throw error;
                if (error.kind === "rate_limited") sdBlocked = true;
                // kegagalan lain: coba lagi pada siklus berikutnya
            }
        }

        // ---- Event + linimasa ----
        // Kamera tanpa riwayat sama sekali (mis. status sudah terisi dari seed/impor) tetap
        // mendapat event dasar agar uptime dan hitungan putus punya titik awal.
        const timeline = await store.eventsSince(camera.id, new Date(now.getTime() - 7 * DAY));
        if (connectionChanged || sdStatus !== camera.sdStatus || timeline.length === 0) {
            await store.addEvent(camera.id, {
                status: raw,
                sdStatus,
                at: now,
                note: !check ? "Perangkat tidak ada di akun EZVIZ" : undefined,
            });
            timeline.push({ status: raw, at: now });
            result.changed++;
        }
        const disconnectsToday = countDisconnects(timeline, dayStart);

        const patch: CameraPatch = {
            status: deriveStatus(raw, disconnectsToday, config.unstableThreshold),
            statusSince: connectionChanged || !camera.statusSince ? now : camera.statusSince,
            lastCheckedAt: now,
            disconnectsToday,
            uptime7d: computeUptime(timeline, now),
            sdStatus,
            ...(sdCheckedAt && sdCheckedAt !== camera.sdCheckedAt ? { sdCheckedAt } : {}),
        };

        // ---- Snapshot (hanya online; memakai data 4G kamera, jadi ada jeda) ----
        if (raw === "ONLINE" && !snapshotBlocked && (connectionChanged || due(camera.snapshotTriedAt, config.snapshotIntervalMin, now))) {
            patch.snapshotTriedAt = now;
            try {
                const image = await gateway.captureSnapshot(ref, { quality: config.snapshotQuality });
                patch.snapshotPath = await snapshots.save(camera.id, image);
                patch.snapshotAt = now;
                result.snapshots++;
            } catch (error) {
                // Kegagalan snapshot (jaringan, perangkat, disk) tidak boleh mengganggu pengecekan status:
                // tercatat lewat snapshotTriedAt dan dicoba lagi setelah jeda.
                if (isGatewayError(error) && error.kind === "rate_limited") snapshotBlocked = true;
            }
        }

        await store.updateCamera(camera.id, patch);
        result.checked++;
    }

    result.rateLimited = sdBlocked || snapshotBlocked;
    return result;
}

export type PollSummary = {
    startedAt: Date;
    accounts: number;
    results: AccountPollResult[];
    /** akun yang melempar error tak terduga (bukan GatewayError) */
    crashed: { accountId: string; message: string }[];
};

/** Cek semua akun aktif dengan konkurensi terbatas; satu akun gagal tidak menghentikan yang lain. */
export async function pollAllAccounts(input: PollDeps): Promise<PollSummary> {
    const deps = resolveDeps(input);
    const accountIds = await deps.store.listActiveAccountIds();
    const summary: PollSummary = { startedAt: deps.now(), accounts: accountIds.length, results: [], crashed: [] };

    const queue = [...accountIds];
    const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            try {
                summary.results.push(await pollAccount(id, deps));
            } catch (error) {
                summary.crashed.push({ accountId: id, message: error instanceof Error ? error.message : "error tidak dikenal" });
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(deps.config.concurrency, queue.length) }, worker));
    return summary;
}
