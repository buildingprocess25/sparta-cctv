import "server-only";
import { getDataSource, getGateway } from "@/lib/cameras";
import { isGatewayError, type GatewayErrorKind } from "@/lib/cameras/errors";
import { startOfDayWib } from "@/lib/ezviz/time";
import {
    applyAccountOverride,
    buildDashboard,
    deriveConnectivity,
    toMinuteSegments,
    wibMinutes,
    type CameraView,
    type ConnectivitySlot,
    type DashboardData,
    type DashboardFilters,
    type RecordingSegment,
    type StoreView,
} from "@/lib/monitoring-core";
import { mockAccountId, mockSerial, seedContractors, seedStores } from "@/lib/seed-data";

export type * from "@/lib/monitoring-core";

/** Menit sejak 08:12 WIB hari ini — "online sejak" bawaan untuk kamera mock. */
function onlineSinceMinutes(now: number) {
    const diff = wibMinutes(new Date(now)) - (8 * 60 + 12);
    return diff >= 0 ? diff : diff + 1440;
}

function loadMockStores(now: number): StoreView[] {
    // Simulasi pengembangan: MOCK_BROKEN_ACCOUNT=1,3 → akun EZVIZ kontraktor ke-1 dan ke-3 bermasalah.
    const broken = (process.env.MOCK_BROKEN_ACCOUNT ?? "")
        .split(",")
        .map((v) => Number.parseInt(v, 10))
        .filter(Number.isFinite);
    return seedStores.map<StoreView>((s, si) => ({
        id: s.code,
        code: s.code,
        name: s.name,
        address: s.address,
        contractorName: seedContractors[s.contractor].name,
        contractorPhone: seedContractors[s.contractor].phone,
        contractorPic: seedContractors[s.contractor].pic,
        ezvizAccount: {
            id: mockAccountId(s.contractor),
            status: broken.includes(s.contractor) ? "TOKEN_ERROR" : "ACTIVE",
            lastError: null,
        },
        progress: s.progress,
        targetDate: new Date(s.targetDate),
        cameras: s.cameras.map<CameraView>((c, ci) => ({
            id: `${s.code}:${c.label}`,
            label: c.label,
            area: c.area,
            status: c.status ?? "ONLINE",
            statusSince: new Date(now - (c.sinceMinutes ?? onlineSinceMinutes(now)) * 60_000),
            disconnectsToday: c.disconnectsToday ?? 0,
            sdStatus: c.sdStatus ?? "OK",
            uptime7d: c.uptime7d ?? 99.5,
            lastSnapshotAt: new Date(now - ((si + ci) % 5) * 120_000 - 120_000),
            snapshotUrl: null,
            deviceModel: "EZVIZ H8c 4G",
            deviceSerial: mockSerial(si, ci),
            channelNo: 1,
        })),
    }));
}

async function loadDbStores(checkedAt: Date): Promise<StoreView[]> {
    const { default: prisma } = await import("@/lib/prisma");
    const rows = await prisma.store.findMany({
        include: {
            contractor: { include: { ezvizAccount: { select: { id: true, status: true, lastError: true } } } },
            cameras: { orderBy: { label: "asc" } },
        },
        orderBy: { name: "asc" },
    });
    return rows.map<StoreView>((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        address: s.address,
        contractorName: s.contractor.name,
        contractorPhone: s.contractor.phone,
        contractorPic: s.contractor.picName,
        ezvizAccount: s.contractor.ezvizAccount,
        progress: s.progress,
        targetDate: s.targetDate,
        cameras: s.cameras.map<CameraView>((c) => ({
            id: c.id,
            label: c.label,
            area: c.area,
            status: c.status,
            statusSince: c.statusSince,
            disconnectsToday: c.disconnectsToday,
            sdStatus: c.sdStatus,
            uptime7d: c.uptime7d,
            lastSnapshotAt: c.snapshotAt ?? c.lastCheckedAt ?? checkedAt,
            snapshotUrl:
                c.snapshotPath && c.snapshotAt
                    ? `/api/cameras/${encodeURIComponent(c.id)}/snapshot?v=${c.snapshotAt.getTime()}`
                    : null,
            deviceModel: c.deviceModel,
            deviceSerial: c.deviceSerial,
            channelNo: c.channelNo,
        })),
    }));
}

/**
 * Semua toko + kamera dari sumber data aktif. Mode "db" dan "ezviz" sama-sama membaca
 * status dari database (ditulis oleh poller); mode "mock" memakai data contoh.
 */
async function loadStores(): Promise<{ stores: StoreView[]; checkedAt: Date }> {
    const now = Date.now();
    const checkedAt = new Date(Math.floor(now / 300_000) * 300_000);
    const stores =
        getDataSource() === "mock" ? loadMockStores(now) : await loadDbStores(checkedAt);
    return { stores: applyAccountOverride(stores), checkedAt };
}

export async function getDashboardData(filters: DashboardFilters = {}): Promise<DashboardData> {
    const { stores, checkedAt } = await loadStores();
    return buildDashboard(stores, checkedAt, filters);
}

// ---------------------------------------------------------------------------
// Detail kamera (Live View)
// ---------------------------------------------------------------------------

export type CameraDetail = {
    camera: CameraView;
    store: StoreView;
    lastCheckedAt: Date;
    /** 30 slot untuk 24 jam terakhir */
    connectivity: ConnectivitySlot[];
    /** rekaman MicroSD hari ini, dalam menit sejak 00:00 WIB */
    recordings: RecordingSegment[];
    /** alasan rekaman tidak bisa dimuat; null bila berhasil */
    recordingsError: GatewayErrorKind | null;
    nowMinutes: number;
};

type RecordingsResult = { recordings: RecordingSegment[]; recordingsError: GatewayErrorKind | null };

/** Segmen rekaman MicroSD satu hari (menit sejak 00:00 WIB), dipotong sampai `until`. */
async function loadRecordings(camera: CameraView, store: StoreView, dayStart: Date, until: Date): Promise<RecordingsResult> {
    if (camera.status === "UNKNOWN") return { recordings: [], recordingsError: "account_unavailable" };
    try {
        const ranges = await getGateway().listRecordings(
            {
                accountId: store.ezvizAccount?.id ?? null,
                deviceSerial: camera.deviceSerial,
                channelNo: camera.channelNo,
            },
            { start: dayStart, end: until },
        );
        return { recordings: toMinuteSegments(ranges, dayStart), recordingsError: null };
    } catch (error) {
        if (!isGatewayError(error)) throw error;
        return { recordings: [], recordingsError: error.kind };
    }
}

export async function getCameraDetail(id: string): Promise<CameraDetail | null> {
    const { stores, checkedAt } = await loadStores();
    for (const store of stores) {
        const camera = store.cameras.find((c) => c.id === id);
        if (!camera) continue;

        const now = new Date();
        const { recordings, recordingsError } = await loadRecordings(camera, store, startOfDayWib(now), now);

        return {
            camera,
            store,
            lastCheckedAt: checkedAt,
            connectivity: deriveConnectivity(camera, now),
            recordings,
            recordingsError,
            nowMinutes: wibMinutes(now),
        };
    }
    return null;
}

/** Rekaman MicroSD kamera pada hari yang dimulai `dayStart` (00:00 WIB); null bila kamera tidak ada. */
export async function getCameraRecordings(id: string, dayStart: Date): Promise<RecordingsResult | null> {
    const { stores } = await loadStores();
    for (const store of stores) {
        const camera = store.cameras.find((c) => c.id === id);
        if (!camera) continue;
        const now = new Date();
        const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
        return loadRecordings(camera, store, dayStart, dayEnd < now ? dayEnd : now);
    }
    return null;
}
