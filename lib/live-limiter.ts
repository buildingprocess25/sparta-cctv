// Pembatas live: paket Free EZVIZ hanya kuat 1 stream aktif per akun (bandwidth 1 Mbps).
// Logika murni; pengambilan data sesi dilakukan pemanggil.

export type LiveSessionLike = {
    id: string;
    cameraId: string;
    expiresAt: Date;
    endedAt: Date | null;
};

export function isActive(session: LiveSessionLike, now: Date): boolean {
    return session.endedAt === null && session.expiresAt > now;
}

/** Sesi aktif milik kamera LAIN pada akun yang sama; non-null berarti permintaan harus ditolak. */
export function findConflict(sessions: LiveSessionLike[], cameraId: string, now: Date): LiveSessionLike | null {
    return sessions.find((s) => isActive(s, now) && s.cameraId !== cameraId) ?? null;
}
