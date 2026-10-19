// Pencatatan pemakaian harian per akun (memantau batas paket Free).

/** Detik live yang layak dicatat untuk satu sesi: dari mulai sampai berakhir/kedaluwarsa, tidak negatif. */
export function liveSecondsOf(session: { startedAt: Date; expiresAt: Date }, endedAt: Date): number {
    const end = Math.min(endedAt.getTime(), session.expiresAt.getTime());
    return Math.max(0, Math.round((end - session.startedAt.getTime()) / 1000));
}

export async function addLiveSeconds(accountId: string, seconds: number, now = new Date()): Promise<void> {
    if (seconds <= 0) return;
    const { default: prisma } = await import("@/lib/prisma");
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await prisma.ezvizUsageDaily.upsert({
        where: { accountId_date: { accountId, date } },
        create: { accountId, date, liveSeconds: seconds },
        update: { liveSeconds: { increment: seconds } },
    });
}

export async function addSnapshotCall(accountId: string, now = new Date()): Promise<void> {
    const { default: prisma } = await import("@/lib/prisma");
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await prisma.ezvizUsageDaily.upsert({
        where: { accountId_date: { accountId, date } },
        create: { accountId, date, snapshotCalls: 1 },
        update: { snapshotCalls: { increment: 1 } },
    });
}
