export type PollerConfig = {
    /** jumlah putus hari ini yang membuat kamera online dianggap tidak stabil */
    unstableThreshold: number;
    /** jeda minimum antar pengecekan MicroSD per kamera (menit) */
    sdCheckIntervalMin: number;
    /** jeda minimum antar snapshot per kamera (menit) — memakai data 4G kamera */
    snapshotIntervalMin: number;
    /** kualitas snapshot EZVIZ: 0 lancar, 1 HD 720P */
    snapshotQuality: 0 | 1 | 2 | 3 | 4;
    /** jumlah akun yang dicek bersamaan (satu akun selalu berurutan) */
    concurrency: number;
};

function int(value: string | undefined, fallback: number, min = 1) {
    const n = Number.parseInt(value ?? "", 10);
    return Number.isFinite(n) && n >= min ? n : fallback;
}

export function loadPollerConfig(env: Record<string, string | undefined> = process.env): PollerConfig {
    return {
        unstableThreshold: int(env.POLL_UNSTABLE_THRESHOLD, 3),
        sdCheckIntervalMin: int(env.POLL_SD_INTERVAL_MIN, 30),
        snapshotIntervalMin: int(env.POLL_SNAPSHOT_INTERVAL_MIN, 15),
        snapshotQuality: 1,
        concurrency: int(env.POLL_CONCURRENCY, 3),
    };
}
