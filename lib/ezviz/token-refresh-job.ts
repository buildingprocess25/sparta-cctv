import type { AccountStore } from "./account-store";
import type { TokenManager } from "./token-manager";

// Jaring pengaman harian: memperbarui token yang hampir habis walau akunnya sedang sepi
// panggilan, dan mencoba lagi akun TOKEN_ERROR dengan jeda (agar tidak membanjiri EZVIZ
// bila kontraktor sudah mengganti secret).

const HOUR = 3_600_000;

export type RefreshAction = "refreshed" | "retried" | "skipped" | "failed";

export type RefreshJobResult = {
    accountId: string;
    action: RefreshAction;
    reason?: string;
    error?: string;
};

export type RefreshJobOptions = {
    store: AccountStore;
    tokens: TokenManager;
    now?: () => Date;
    /** perbarui bila sisa umur token ≤ ini (bawaan 24 jam) */
    withinMs?: number;
    /** coba lagi akun TOKEN_ERROR bila error terakhir sudah selama ini (bawaan 6 jam) */
    retryAfterMs?: number;
};

export async function refreshDueTokens(options: RefreshJobOptions): Promise<RefreshJobResult[]> {
    const { store, tokens } = options;
    const now = (options.now ?? (() => new Date()))();
    const withinMs = options.withinMs ?? 24 * HOUR;
    const retryAfterMs = options.retryAfterMs ?? 6 * HOUR;

    const results: RefreshJobResult[] = [];
    for (const account of await store.listAll()) {
        const accountId = account.id;
        try {
            if (account.status === "DISABLED") {
                results.push({ accountId, action: "skipped", reason: "dinonaktifkan" });
            } else if (account.status === "TOKEN_ERROR") {
                const waited = account.lastErrorAt ? now.getTime() - account.lastErrorAt.getTime() : Infinity;
                if (waited < retryAfterMs) {
                    results.push({ accountId, action: "skipped", reason: "menunggu jeda coba ulang" });
                } else {
                    await tokens.refresh(accountId, { force: true });
                    results.push({ accountId, action: "retried" });
                }
            } else {
                const remaining = account.tokenExpiresAt ? account.tokenExpiresAt.getTime() - now.getTime() : -Infinity;
                if (remaining > withinMs) {
                    results.push({ accountId, action: "skipped", reason: "token masih lama" });
                } else {
                    await tokens.refresh(accountId, { force: true });
                    results.push({ accountId, action: "refreshed" });
                }
            }
        } catch (error) {
            // Pesan error EZVIZ tidak memuat secret/token (lihat lib/ezviz/errors.ts).
            results.push({ accountId, action: "failed", error: error instanceof Error ? error.message : "error tidak dikenal" });
        }
    }
    return results;
}
