import type { AccountStore, StoredAccount } from "./account-store";

/** Implementasi dalam memori: untuk tes dan pengembangan tanpa database. */
export class MemoryAccountStore implements AccountStore {
    readonly accounts = new Map<string, StoredAccount>();
    private readonly locks = new Map<string, Promise<unknown>>();

    constructor(private readonly clock: () => Date = () => new Date()) {}

    add(account: Omit<StoredAccount, "lastError" | "lastErrorAt">) {
        this.accounts.set(account.id, { ...account, lastError: null, lastErrorAt: null });
    }

    async listAll() {
        return [...this.accounts.values()].map((a) => ({ ...a }));
    }

    async get(id: string) {
        const a = this.accounts.get(id);
        return a ? { ...a } : null;
    }

    async saveToken(
        id: string,
        data: { accessTokenEnc: string; tokenExpiresAt: Date; areaDomain: string },
    ) {
        const a = this.accounts.get(id);
        if (!a) throw new Error(`akun ${id} tidak ada`);
        Object.assign(a, data, { status: "ACTIVE" as const, lastError: null, lastErrorAt: null });
    }

    async recordError(id: string, message: string, status?: "TOKEN_ERROR") {
        const a = this.accounts.get(id);
        if (!a) return;
        a.lastError = message;
        a.lastErrorAt = this.clock();
        if (status) a.status = status;
    }

    async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(id) ?? Promise.resolve();
        const run = previous.then(fn, fn);
        this.locks.set(
            id,
            run.catch(() => undefined),
        );
        return run;
    }
}
