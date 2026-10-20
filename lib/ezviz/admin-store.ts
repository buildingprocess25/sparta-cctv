import type { AccountStatusValue, AccountStore } from "./account-store";

export type AccountSummary = {
    id: string;
    appKey: string;
    status: AccountStatusValue;
    tokenExpiresAt: Date | null;
    areaDomain: string | null;
    deviceLimit: number;
    lastError: string | null;
    lastErrorAt: Date | null;
    lastTokenRefreshAt: Date | null;
};

export type ContractorOverview = {
    contractorId: string;
    contractorName: string;
    account: AccountSummary | null;
    /** kamera yang sudah dipetakan ke serial perangkat (dihitung terhadap batas device) */
    mappedDevices: number;
    cameraCount: number;
};

export type ContractorCamera = {
    id: string;
    label: string;
    area: string;
    storeId: string;
    storeName: string;
    storeCode: string;
    deviceSerial: string | null;
};

export type StoreSummary = {
    id: string;
    name: string;
    code: string;
};

export type CameraOwner = { id: string; contractorId: string; label: string; storeName: string; deviceSerial: string | null };

export type AuditEntry = {
    action: string;
    entity: string;
    entityId?: string | null;
    /** ringkasan perubahan — tidak boleh memuat secret/token */
    detail?: string;
};

/** Penyimpanan untuk layanan admin akun EZVIZ; memperluas AccountStore yang dipakai TokenManager. */
export interface AdminStore extends AccountStore {
    listContractors(): Promise<ContractorOverview[]>;
    getContractor(contractorId: string): Promise<ContractorOverview | null>;
    listContractorCameras(contractorId: string): Promise<ContractorCamera[]>;
    listStoresByContractor(contractorId: string): Promise<StoreSummary[]>;

    createAccount(input: { id: string; contractorId: string; appKey: string; appSecretEnc: string }): Promise<void>;
    /** Ganti kredensial: token lama dibuang; status ACTIVE kecuali sedang DISABLED; error dihapus. */
    updateCredentials(accountId: string, input: { appKey: string; appSecretEnc?: string }): Promise<void>;
    setAccountStatus(accountId: string, status: "ACTIVE" | "DISABLED"): Promise<void>;

    getCamera(cameraId: string): Promise<CameraOwner | null>;
    findCameraBySerial(serial: string): Promise<CameraOwner | null>;
    countMappedCameras(contractorId: string): Promise<number>;
    /** Mengubah serial → status pemantauan kamera direset (belum dicek lagi). */
    setCameraSerial(cameraId: string, serial: string | null): Promise<void>;
    /** Tambah kamera baru ke toko milik kontraktor. */
    createCamera(input: { storeId: string; label: string; area: string }): Promise<ContractorCamera>;
    /** Hapus kamera; mengembalikan false jika tidak ditemukan. */
    deleteCamera(cameraId: string): Promise<boolean>;

    audit(entry: AuditEntry): Promise<void>;
}
