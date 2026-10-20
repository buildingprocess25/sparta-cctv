// Logika murni dashboard: tipe, penyaringan, penghitungan, dan alert.
// Tanpa akses data/server-only agar mudah diuji (lihat monitoring-core.test.ts).

export type CameraStatus = "ONLINE" | "OFFLINE" | "UNSTABLE" | "UNKNOWN";
export type SdStatus = "OK" | "NOT_FORMATTED" | "UNREADABLE" | "NONE";
export type StatusFilter = "all" | "online" | "offline" | "unstable" | "unknown" | "sd";
export type EzvizAccountState = "ACTIVE" | "TOKEN_ERROR" | "DISABLED";

export type CameraView = {
    id: string;
    label: string;
    area: string;
    status: CameraStatus;
    statusSince: Date | null;
    disconnectsToday: number;
    sdStatus: SdStatus;
    uptime7d: number | null;
    lastSnapshotAt: Date;
    /** URL snapshot terbaru (route internal); null bila belum ada / mode mock */
    snapshotUrl: string | null;
    deviceModel: string | null;
    deviceSerial: string | null;
    channelNo: number;
};

export type StoreView = {
    id: string;
    code: string;
    name: string;
    address: string;
    contractorId: string;
    contractorName: string;
    contractorPhone: string | null;
    contractorPic: string | null;
    /** akun EZVIZ kontraktor; null = belum punya akun */
    ezvizAccount: { id: string; status: EzvizAccountState; lastError: string | null } | null;
    progress: number;
    targetDate: Date | null;
    cameras: CameraView[];
};

export type AlertKind = "offline" | "unstable" | "sd" | "account";

export type AlertView = {
    id: string;
    kind: AlertKind;
    sdStatus: SdStatus;
    since: Date | null;
    disconnectsToday: number;
    cameraLabel: string;
    area: string;
    storeName: string;
    contractorName: string;
    contractorPhone: string | null;
    /** hanya untuk kind "account": jumlah kamera yang statusnya tidak diketahui */
    unknownCount: number;
    /** hanya untuk kind "account": penyebab (mis. akun dinonaktifkan) */
    accountState: EzvizAccountState | null;
};

export type DashboardStats = {
    online: number;
    total: number;
    offline: number;
    unstable: number;
    unknown: number;
    sdProblems: number;
    stores: number;
};

export type DashboardData = {
    lastCheckedAt: Date;
    stats: DashboardStats;
    stores: StoreView[];
    alerts: AlertView[];
    contractors: string[];
};

export type DashboardFilters = {
    contractor?: string;
    status?: StatusFilter;
    q?: string;
};

/** MicroSD bermasalah hanya dihitung pada kamera yang statusnya diketahui dan tidak offline. */
export const hasSdProblem = (c: CameraView) =>
    c.status !== "OFFLINE" &&
    c.status !== "UNKNOWN" &&
    (c.sdStatus === "NOT_FORMATTED" || c.sdStatus === "UNREADABLE");

/**
 * Bila akun EZVIZ kontraktor tidak dapat dipakai (nonaktif / kredensial bermasalah),
 * status kamera-kameranya TIDAK diketahui — bukan offline.
 */
export function applyAccountOverride(stores: StoreView[]): StoreView[] {
    return stores.map((store) => {
        const account = store.ezvizAccount;
        if (!account || account.status === "ACTIVE") return store;
        return {
            ...store,
            cameras: store.cameras.map((c) => ({ ...c, status: "UNKNOWN" as const, statusSince: null })),
        };
    });
}

function matchesStatus(c: CameraView, status: StatusFilter) {
    switch (status) {
        case "online":
            return c.status === "ONLINE";
        case "offline":
            return c.status === "OFFLINE";
        case "unstable":
            return c.status === "UNSTABLE";
        case "unknown":
            return c.status === "UNKNOWN";
        case "sd":
            return hasSdProblem(c);
        default:
            return true;
    }
}

const ALERT_RANK: Record<AlertKind, number> = { offline: 0, account: 1, unstable: 2, sd: 3 };

export function buildDashboard(
    all: StoreView[],
    checkedAt: Date,
    filters: DashboardFilters = {},
): DashboardData {
    const contractors = [...new Set(all.map((s) => s.contractorName))].sort();
    const q = filters.q?.trim().toLowerCase();
    const status = filters.status ?? "all";

    const filtered = all
        .filter((s) => !filters.contractor || s.contractorName === filters.contractor)
        .filter((s) => !q || [s.name, s.code, s.contractorName].some((v) => v.toLowerCase().includes(q)))
        .filter((s) => status === "all" || s.cameras.some((c) => matchesStatus(c, status)));

    // Toko bermasalah tampil lebih dulu, lalu urut nama.
    const issueCount = (s: StoreView) =>
        s.cameras.filter((c) => c.status !== "ONLINE" || hasSdProblem(c)).length;
    const stores = [...filtered].sort(
        (a, b) =>
            Number(issueCount(b) > 0) - Number(issueCount(a) > 0) ||
            a.name.localeCompare(b.name, "id"),
    );

    const alerts: AlertView[] = [];
    const accountAlerts = new Map<string, AlertView>();

    for (const store of stores) {
        const account = store.ezvizAccount;
        // Satu alert per akun bermasalah (bukan satu per kamera).
        if (account && account.status !== "ACTIVE") {
            const existing = accountAlerts.get(account.id);
            if (existing) {
                existing.unknownCount += store.cameras.length;
            } else {
                accountAlerts.set(account.id, {
                    id: `account-${account.id}`,
                    kind: "account",
                    sdStatus: "OK",
                    since: null,
                    disconnectsToday: 0,
                    cameraLabel: "",
                    area: "",
                    storeName: "",
                    contractorName: store.contractorName,
                    contractorPhone: store.contractorPhone,
                    unknownCount: store.cameras.length,
                    accountState: account.status,
                });
            }
            continue;
        }

        for (const c of store.cameras) {
            const base = {
                id: c.id,
                sdStatus: c.sdStatus,
                since: c.statusSince,
                disconnectsToday: c.disconnectsToday,
                cameraLabel: c.label,
                area: c.area,
                storeName: store.name,
                contractorName: store.contractorName,
                contractorPhone: store.contractorPhone,
                unknownCount: 0,
                accountState: null,
            };
            if (c.status === "OFFLINE") alerts.push({ ...base, kind: "offline" });
            else if (c.status === "UNSTABLE") alerts.push({ ...base, kind: "unstable" });
            else if (hasSdProblem(c)) alerts.push({ ...base, kind: "sd" });
        }
    }
    alerts.push(...accountAlerts.values());
    alerts.sort(
        (a, b) =>
            ALERT_RANK[a.kind] - ALERT_RANK[b.kind] ||
            (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0),
    );

    const cameras = stores.flatMap((s) => s.cameras);
    return {
        lastCheckedAt: checkedAt,
        stats: {
            online: cameras.filter((c) => c.status === "ONLINE").length,
            total: cameras.length,
            offline: cameras.filter((c) => c.status === "OFFLINE").length,
            unstable: cameras.filter((c) => c.status === "UNSTABLE").length,
            unknown: cameras.filter((c) => c.status === "UNKNOWN").length,
            sdProblems: cameras.filter(hasSdProblem).length,
            stores: stores.length,
        },
        stores,
        alerts,
        contractors,
    };
}

// ---------------------------------------------------------------------------
// Multi-live per kontraktor
// ---------------------------------------------------------------------------

export type LiveGridCamera = CameraView & { storeName: string; storeCode: string };

export type ContractorLiveView = {
    contractor: { id: string; name: string };
    /** akun EZVIZ kontraktor; null = belum punya akun */
    account: StoreView["ezvizAccount"];
    /** semua kamera kontraktor, urut nama toko lalu label */
    cameras: LiveGridCamera[];
};

/** Kamera satu kontraktor untuk grid multi-live; null bila kontraktor tidak punya toko. */
export function buildContractorLive(stores: StoreView[], contractorId: string): ContractorLiveView | null {
    const own = stores
        .filter((s) => s.contractorId === contractorId)
        .sort((a, b) => a.name.localeCompare(b.name, "id"));
    if (own.length === 0) return null;
    return {
        contractor: { id: contractorId, name: own[0].contractorName },
        account: own[0].ezvizAccount,
        cameras: own.flatMap((s) =>
            [...s.cameras]
                .sort((a, b) => a.label.localeCompare(b.label, "id"))
                .map((c) => ({ ...c, storeName: s.name, storeCode: s.code })),
        ),
    };
}

/** Kamera yang bisa diputar live (online / tidak stabil). */
export const canGoLive = (c: CameraView) => c.status === "ONLINE" || c.status === "UNSTABLE";

/** Id kamera yang langsung diputar saat grid dibuka: kamera yang bisa live, maksimal `max`, sesuai urutan. */
export function pickLiveCameras(cameras: CameraView[], max: number): string[] {
    return cameras.filter(canGoLive).slice(0, Math.max(0, max)).map((c) => c.id);
}

// ---------------------------------------------------------------------------
// Detail kamera
// ---------------------------------------------------------------------------

export type ConnectivitySlot = "up" | "down" | "degraded";
export type RecordingSegment = { startMin: number; endMin: number };

export function wibMinutes(date: Date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return get("hour") * 60 + get("minute");
}

/** Rentang rekaman (Date) → menit sejak 00:00 WIB pada hari `dayStart`, untuk timeline. */
export function toMinuteSegments(
    ranges: { start: Date; end: Date }[],
    dayStart: Date,
): RecordingSegment[] {
    return ranges
        .map((r) => ({
            startMin: Math.max(0, Math.round((r.start.getTime() - dayStart.getTime()) / 60_000)),
            endMin: Math.min(1440, Math.round((r.end.getTime() - dayStart.getTime()) / 60_000)),
        }))
        .filter((s) => s.endMin > s.startMin);
}

function hashString(value: string) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * Riwayat konektivitas 24 jam. Sementara diturunkan secara deterministik dari
 * status kamera; akan diganti data CameraEvent saat poller berjalan (Fase 4).
 */
export function deriveConnectivity(camera: CameraView, now: Date, slots = 30): ConnectivitySlot[] {
    const result: ConnectivitySlot[] = Array(slots).fill("up");
    if (camera.status === "UNKNOWN") return result; // tidak ada data: jangan mengarang kegagalan
    let seed = hashString(camera.id);
    const next = () => (seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0);

    const drops = Math.max(camera.disconnectsToday, camera.status === "ONLINE" ? 0 : 1);
    for (let i = 0; i < drops; i++) {
        const at = 8 + (next() % (slots - 12));
        result[at] = "down";
        if (i % 2 === 1 && at + 1 < slots) result[at + 1] = "degraded";
    }
    if (camera.status === "OFFLINE" && camera.statusSince) {
        const missing = Math.min(
            slots,
            Math.max(1, Math.round(((now.getTime() - camera.statusSince.getTime()) / 3_600_000 / 24) * slots)),
        );
        for (let i = slots - missing; i < slots; i++) result[i] = "down";
    }
    return result;
}
