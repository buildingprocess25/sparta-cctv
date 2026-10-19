import "server-only";
import type { AccountStore, StoredAccount } from "./account-store";

// Prisma dimuat saat dipakai (bukan saat modul diimpor) supaya mode mock tetap
// berjalan tanpa DATABASE_URL.
async function db() {
    return (await import("@/lib/prisma")).default;
}

function toStored(a: {
    id: string;
    appKey: string;
    appSecretEnc: string;
    accessTokenEnc: string | null;
    tokenExpiresAt: Date | null;
    areaDomain: string | null;
    status: StoredAccount["status"];
    lastError: string | null;
    lastErrorAt: Date | null;
}): StoredAccount {
    return {
        id: a.id,
        appKey: a.appKey,
        appSecretEnc: a.appSecretEnc,
        accessTokenEnc: a.accessTokenEnc,
        tokenExpiresAt: a.tokenExpiresAt,
        areaDomain: a.areaDomain,
        status: a.status,
        lastError: a.lastError,
        lastErrorAt: a.lastErrorAt,
    };
}

/** Penyimpanan akun di PostgreSQL. Kunci lintas proses memakai advisory lock transaksi. */
export class PrismaAccountStore implements AccountStore {
    async get(id: string): Promise<StoredAccount | null> {
        const a = await (await db()).ezvizAccount.findUnique({ where: { id } });
        return a ? toStored(a) : null;
    }

    async listAll(): Promise<StoredAccount[]> {
        return (await (await db()).ezvizAccount.findMany({ orderBy: { createdAt: "asc" } })).map(toStored);
    }

    async saveToken(
        id: string,
        data: { accessTokenEnc: string; tokenExpiresAt: Date; areaDomain: string },
    ) {
        await (await db()).ezvizAccount.update({
            where: { id },
            data: {
                ...data,
                status: "ACTIVE",
                lastError: null,
                lastErrorAt: null,
                lastTokenRefreshAt: new Date(),
            },
        });
    }

    async recordError(id: string, message: string, status?: "TOKEN_ERROR") {
        await (await db()).ezvizAccount.updateMany({
            where: { id },
            data: { lastError: message.slice(0, 500), lastErrorAt: new Date(), ...(status ? { status } : {}) },
        });
    }

    async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
        // Lock dipegang sampai transaksi selesai; `fn` (panggilan HTTP) berjalan di dalamnya.
        return (await db()).$transaction(
            async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ezviz-account:${id}`}))`;
                return fn();
            },
            { maxWait: 20_000, timeout: 30_000 },
        );
    }
}
