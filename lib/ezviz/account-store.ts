// Antarmuka penyimpanan akun untuk token manager. Dipisah dari Prisma agar logika
// token bisa diuji tanpa database (lihat memory-account-store.ts).

export type AccountStatusValue = "ACTIVE" | "TOKEN_ERROR" | "DISABLED";

export type StoredAccount = {
    id: string;
    appKey: string;
    appSecretEnc: string;
    accessTokenEnc: string | null;
    tokenExpiresAt: Date | null;
    areaDomain: string | null;
    status: AccountStatusValue;
    lastError: string | null;
    lastErrorAt: Date | null;
};

export interface AccountStore {
    get(id: string): Promise<StoredAccount | null>;

    /** Semua akun (untuk pekerjaan terjadwal). */
    listAll(): Promise<StoredAccount[]>;

    /** Simpan token baru; sekaligus status → ACTIVE dan hapus error terakhir. */
    saveToken(
        id: string,
        data: { accessTokenEnc: string; tokenExpiresAt: Date; areaDomain: string },
    ): Promise<void>;

    /** Catat error terakhir; `status` diisi bila akun perlu ditandai (mis. TOKEN_ERROR). */
    recordError(id: string, message: string, status?: "TOKEN_ERROR"): Promise<void>;

    /** Jalankan `fn` dengan kunci eksklusif per akun (lintas proses). */
    withLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
}
