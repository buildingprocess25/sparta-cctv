// Pembatas live: paket Free EZVIZ hanya 1 Mbps per akun, jadi jumlah stream bersamaan per akun
// dibatasi (bawaan 2 sub-stream) dan HD hanya boleh bila akun tidak sedang dipakai kamera lain.
// Logika murni; pengambilan data sesi dilakukan pemanggil.

export type LiveSessionLike = {
    id: string;
    cameraId: string;
    expiresAt: Date;
    endedAt: Date | null;
    /** 1 HD (bitrate utama), 2 sub-stream */
    quality: number;
};

export type LiveQuality = 1 | 2;

/** "full": slot akun penuh; "hd_busy": HD diminta/berjalan bersamaan dengan kamera lain. */
export type CapacityDenial = "full" | "hd_busy";

export const DEFAULT_MAX_LIVE_SESSIONS = 2;

/** LIVE_MAX_SESSIONS_PER_ACCOUNT, minimal 1. */
export function maxLiveSessions(env: Record<string, string | undefined> = process.env): number {
    const n = Number.parseInt(env.LIVE_MAX_SESSIONS_PER_ACCOUNT ?? "", 10);
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_LIVE_SESSIONS;
}

export function isActive(session: LiveSessionLike, now: Date): boolean {
    return session.endedAt === null && session.expiresAt > now;
}

/**
 * Boleh tidaknya kamera `cameraId` membuka sesi baru. Sesi kamera yang sama tidak dihitung
 * (akan ditutup dan diganti). null = boleh.
 */
export function checkCapacity(
    sessions: LiveSessionLike[],
    cameraId: string,
    now: Date,
    opts: { max: number; quality: LiveQuality },
): CapacityDenial | null {
    const others = sessions.filter((s) => isActive(s, now) && s.cameraId !== cameraId);
    if (others.length === 0) return null;
    if (opts.quality === 1 || others.some((s) => s.quality === 1)) return "hd_busy";
    return others.length >= opts.max ? "full" : null;
}

export function denialMessage(denial: CapacityDenial, max: number): string {
    return denial === "full"
        ? `Slot live akun kontraktor ini penuh (maks. ${max} kamera). Tutup salah satu live.`
        : "Kualitas HD hanya bisa dipakai bila hanya satu kamera yang live di akun kontraktor ini.";
}
