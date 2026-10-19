// Aturan murni untuk poller: status turunan, hitungan putus, dan uptime.
// Semua berdasarkan linimasa CameraEvent (status koneksi mentah: ONLINE/OFFLINE/UNKNOWN).

export type RawStatus = "ONLINE" | "OFFLINE" | "UNKNOWN";
export type DerivedStatus = RawStatus | "UNSTABLE";

export type TimelineEvent = { status: RawStatus; at: Date };

const DAY_MS = 86_400_000;

/** Status yang tersimpan pada Camera.status → status koneksi mentah. */
export function rawOf(status: DerivedStatus): RawStatus {
    return status === "UNSTABLE" ? "ONLINE" : status;
}

/**
 * Tidak stabil = sedang online tetapi sudah putus ≥ `threshold` kali hari ini.
 * Offline/unknown tidak pernah dianggap tidak stabil.
 */
export function deriveStatus(raw: RawStatus, disconnectsToday: number, threshold: number): DerivedStatus {
    return raw === "ONLINE" && disconnectsToday >= threshold ? "UNSTABLE" : raw;
}

/**
 * Jumlah putus sejak `since`: transisi ONLINE → OFFLINE. Transisi dari UNKNOWN
 * (belum pernah terukur) tidak dihitung putus.
 * `events` terurut naik; elemen pertama boleh berupa event sebelum `since` (pendahulu).
 */
export function countDisconnects(events: TimelineEvent[], since: Date): number {
    let count = 0;
    for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1];
        const cur = events[i];
        if (cur.at >= since && prev.status === "ONLINE" && cur.status === "OFFLINE") count++;
    }
    return count;
}

/**
 * Persentase waktu online selama 7 hari terakhir dari waktu yang terukur.
 * Waktu UNKNOWN tidak dihitung (di pembilang maupun penyebut). Riwayat yang lebih
 * pendek dari 7 hari memakai jendela sejak event pertama. null bila belum ada data.
 */
export function computeUptime(events: TimelineEvent[], now: Date, windowMs = 7 * DAY_MS): number | null {
    if (events.length === 0) return null;
    const windowStart = now.getTime() - windowMs;

    let online = 0;
    let offline = 0;
    for (let i = 0; i < events.length; i++) {
        const from = Math.max(events[i].at.getTime(), windowStart);
        const to = i + 1 < events.length ? events[i + 1].at.getTime() : now.getTime();
        const end = Math.min(to, now.getTime());
        if (end <= from) continue;
        if (events[i].status === "ONLINE") online += end - from;
        else if (events[i].status === "OFFLINE") offline += end - from;
    }
    const measured = online + offline;
    if (measured === 0) return null;
    return Math.round((online / measured) * 1000) / 10; // satu desimal
}
