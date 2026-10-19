import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { AccountStore, StoredAccount } from "./account-store";
import type { EzvizClient } from "./client";
import {
    AccountUnavailableError,
    CredentialError,
    TokenExpiredError,
} from "./errors";

export type TokenContext = {
    accessToken: string;
    areaDomain: string;
    expiresAt: Date;
};

export type TokenManagerOptions = {
    store: AccountStore;
    client: EzvizClient;
    /** kunci enkripsi; bawaan dari env EZVIZ_ENCRYPTION_KEY */
    key?: Buffer;
    /** token diperbarui bila sisa umurnya kurang dari ini (bawaan 12 jam) */
    refreshBeforeMs?: number;
    now?: () => Date;
};

export type RefreshOptions = {
    /** abaikan status TOKEN_ERROR dan sisa umur token (uji koneksi / coba ulang admin) */
    force?: boolean;
    /** token yang baru saja ditolak EZVIZ (10002); bila sudah diganti proses lain, pakai yang baru */
    staleToken?: string;
};

const HOUR = 3_600_000;

export class TokenManager {
    private readonly store: AccountStore;
    private readonly client: EzvizClient;
    private readonly key?: Buffer;
    private readonly refreshBeforeMs: number;
    private readonly now: () => Date;

    constructor(options: TokenManagerOptions) {
        this.store = options.store;
        this.client = options.client;
        this.key = options.key;
        this.refreshBeforeMs = options.refreshBeforeMs ?? 12 * HOUR;
        this.now = options.now ?? (() => new Date());
    }

    /** Token valid untuk akun; memperbarui bila hampir habis. */
    async getValidToken(accountId: string): Promise<TokenContext> {
        const account = await this.requireUsable(accountId);
        const cached = this.readCached(account);
        if (cached && this.remaining(cached) > this.refreshBeforeMs) return cached;

        try {
            return await this.refresh(accountId);
        } catch (error) {
            // Refresh dini gagal sementara tetapi token lama masih berlaku → tetap dipakai.
            if (cached && this.remaining(cached) > 0 && !(error instanceof CredentialError)) {
                return cached;
            }
            throw error;
        }
    }

    /**
     * Jalankan `fn` dengan token akun. Bila EZVIZ menolak token (10002),
     * token diperbarui sekali dan `fn` diulang sekali.
     */
    async withToken<T>(accountId: string, fn: (ctx: TokenContext) => Promise<T>): Promise<T> {
        const ctx = await this.getValidToken(accountId);
        try {
            return await fn(ctx);
        } catch (error) {
            if (!(error instanceof TokenExpiredError)) throw error;
            const fresh = await this.refresh(accountId, { staleToken: ctx.accessToken });
            return fn(fresh);
        }
    }

    /** Minta token baru (dengan kunci per akun agar tidak ada refresh ganda). */
    async refresh(accountId: string, options: RefreshOptions = {}): Promise<TokenContext> {
        return this.store.withLock(accountId, async () => {
            const account = await this.store.get(accountId);
            if (!account) throw new AccountUnavailableError("Akun EZVIZ tidak ditemukan", "NOT_FOUND");
            if (account.status === "DISABLED") {
                throw new AccountUnavailableError("Akun EZVIZ dinonaktifkan", "DISABLED");
            }
            if (!options.force && account.status === "TOKEN_ERROR") {
                throw this.errorAccount(account);
            }

            // Proses lain mungkin sudah memperbarui token saat kita menunggu kunci.
            const cached = this.readCached(account);
            if (!options.force && cached) {
                if (options.staleToken) {
                    if (cached.accessToken !== options.staleToken && this.remaining(cached) > 0) return cached;
                } else if (this.remaining(cached) > this.refreshBeforeMs) {
                    return cached;
                }
            }

            const appSecret = decryptSecret(account.appSecretEnc, {
                key: this.key,
                aad: `${account.id}:appSecret`,
            });

            try {
                const token = await this.client.getToken(account.appKey, appSecret);
                await this.store.saveToken(account.id, {
                    accessTokenEnc: encryptSecret(token.accessToken, {
                        key: this.key,
                        aad: `${account.id}:accessToken`,
                    }),
                    tokenExpiresAt: token.expiresAt,
                    areaDomain: token.areaDomain,
                });
                return { accessToken: token.accessToken, areaDomain: token.areaDomain, expiresAt: token.expiresAt };
            } catch (error) {
                const message = error instanceof Error ? error.message : "gagal memperbarui token";
                // Hanya kesalahan kredensial yang menandai akun TOKEN_ERROR; gangguan sementara tidak.
                await this.store.recordError(
                    account.id,
                    message,
                    error instanceof CredentialError ? "TOKEN_ERROR" : undefined,
                );
                throw error;
            }
        });
    }

    // ---- helpers ---------------------------------------------------------

    private async requireUsable(accountId: string): Promise<StoredAccount> {
        const account = await this.store.get(accountId);
        if (!account) throw new AccountUnavailableError("Akun EZVIZ tidak ditemukan", "NOT_FOUND");
        if (account.status === "DISABLED") {
            throw new AccountUnavailableError("Akun EZVIZ dinonaktifkan", "DISABLED");
        }
        if (account.status === "TOKEN_ERROR") {
            throw this.errorAccount(account);
        }
        return account;
    }

    private errorAccount(account: StoredAccount) {
        return new AccountUnavailableError(
            `Akun EZVIZ bermasalah: ${account.lastError ?? "kredensial tidak valid"}`,
            "TOKEN_ERROR",
        );
    }

    private readCached(account: StoredAccount): TokenContext | null {
        if (!account.accessTokenEnc || !account.tokenExpiresAt || !account.areaDomain) return null;
        try {
            const accessToken = decryptSecret(account.accessTokenEnc, {
                key: this.key,
                aad: `${account.id}:accessToken`,
            });
            return { accessToken, areaDomain: account.areaDomain, expiresAt: account.tokenExpiresAt };
        } catch {
            return null; // token tersimpan rusak → minta yang baru
        }
    }

    private remaining(ctx: TokenContext) {
        return ctx.expiresAt.getTime() - this.now().getTime();
    }
}
