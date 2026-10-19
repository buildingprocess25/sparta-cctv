import type { EzvizDeviceStatus } from "./types";

export type SdStatusValue = "OK" | "NOT_FORMATTED" | "UNREADABLE" | "NONE";
export type ConnectionStatusValue = "ONLINE" | "OFFLINE" | "UNKNOWN";

/** device/list: 1 online, 0 offline, -1 (atau lainnya) belum melapor. */
export function mapDeviceStatus(status: number): ConnectionStatusValue {
    if (status === 1) return "ONLINE";
    if (status === 0) return "OFFLINE";
    return "UNKNOWN";
}

/**
 * device/status/get → status MicroSD.
 * Mengembalikan null bila perangkat tidak melaporkan (pertahankan nilai terakhir).
 * Bila ada beberapa disk, diambil yang terburuk: UNREADABLE > NOT_FORMATTED > OK.
 */
export function mapSdStatus(status: EzvizDeviceStatus): SdStatusValue | null {
    if (status.diskNum === -1) return null;
    if (status.diskNum === 0) return "NONE";

    const states = status.diskState.slice(0, status.diskNum).split("");
    if (states.length === 0 || states.some((s) => s === "-")) return null;

    let worst: SdStatusValue = "OK";
    for (const s of states) {
        if (s === "1") return "UNREADABLE";
        if (s === "2" || s === "3") worst = "NOT_FORMATTED"; // 3 = sedang diformat
    }
    return worst;
}
