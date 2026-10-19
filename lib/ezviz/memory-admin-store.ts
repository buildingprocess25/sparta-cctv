import type {
    AccountSummary,
    AdminStore,
    AuditEntry,
    CameraOwner,
    ContractorCamera,
    ContractorOverview,
} from "./admin-store";
import { MemoryAccountStore } from "./memory-account-store";

type MemCamera = ContractorCamera & { contractorId: string };

/** Implementasi dalam memori untuk tes layanan admin. */
export class MemoryAdminStore extends MemoryAccountStore implements AdminStore {
    readonly contractors = new Map<string, string>(); // id → nama
    readonly cameras = new Map<string, MemCamera>();
    readonly audits: AuditEntry[] = [];
    private readonly accountByContractor = new Map<string, string>();
    private readonly extras = new Map<string, { deviceLimit: number; lastTokenRefreshAt: Date | null }>();

    addContractor(id: string, name: string) {
        this.contractors.set(id, name);
    }

    addCamera(camera: Partial<MemCamera> & { id: string; contractorId: string }) {
        this.cameras.set(camera.id, {
            label: camera.id.toUpperCase(),
            area: "Area",
            storeId: "store-1",
            storeName: "Toko 1",
            storeCode: "CODE-1",
            deviceSerial: null,
            ...camera,
        });
    }

    setDeviceLimit(accountId: string, limit: number) {
        this.extras.set(accountId, { deviceLimit: limit, lastTokenRefreshAt: null });
    }

    private summary(accountId: string): AccountSummary {
        const a = this.accounts.get(accountId)!;
        const extra = this.extras.get(accountId) ?? { deviceLimit: 10, lastTokenRefreshAt: null };
        return {
            id: a.id,
            appKey: a.appKey,
            status: a.status,
            tokenExpiresAt: a.tokenExpiresAt,
            areaDomain: a.areaDomain,
            deviceLimit: extra.deviceLimit,
            lastError: a.lastError,
            lastErrorAt: a.lastErrorAt,
            lastTokenRefreshAt: extra.lastTokenRefreshAt,
        };
    }

    async getContractor(contractorId: string): Promise<ContractorOverview | null> {
        const name = this.contractors.get(contractorId);
        if (name === undefined) return null;
        const accountId = this.accountByContractor.get(contractorId);
        const cams = [...this.cameras.values()].filter((c) => c.contractorId === contractorId);
        return {
            contractorId,
            contractorName: name,
            account: accountId ? this.summary(accountId) : null,
            mappedDevices: cams.filter((c) => c.deviceSerial).length,
            cameraCount: cams.length,
        };
    }

    async listContractors(): Promise<ContractorOverview[]> {
        const all = await Promise.all([...this.contractors.keys()].map((id) => this.getContractor(id)));
        return all.filter((c): c is ContractorOverview => c !== null);
    }

    async listContractorCameras(contractorId: string): Promise<ContractorCamera[]> {
        return [...this.cameras.values()].filter((c) => c.contractorId === contractorId).map((c) => ({ ...c }));
    }

    async createAccount(input: { id: string; contractorId: string; appKey: string; appSecretEnc: string }) {
        this.add({
            id: input.id,
            appKey: input.appKey,
            appSecretEnc: input.appSecretEnc,
            accessTokenEnc: null,
            tokenExpiresAt: null,
            areaDomain: null,
            status: "ACTIVE",
        });
        this.accountByContractor.set(input.contractorId, input.id);
        this.extras.set(input.id, { deviceLimit: 10, lastTokenRefreshAt: null });
    }

    async updateCredentials(accountId: string, input: { appKey: string; appSecretEnc?: string }) {
        const a = this.accounts.get(accountId)!;
        a.appKey = input.appKey;
        if (input.appSecretEnc) a.appSecretEnc = input.appSecretEnc;
        a.accessTokenEnc = null;
        a.tokenExpiresAt = null;
        a.areaDomain = null;
        a.lastError = null;
        a.lastErrorAt = null;
        if (a.status !== "DISABLED") a.status = "ACTIVE";
    }

    async setAccountStatus(accountId: string, status: "ACTIVE" | "DISABLED") {
        this.accounts.get(accountId)!.status = status;
    }

    private owner(c: MemCamera): CameraOwner {
        return { id: c.id, contractorId: c.contractorId, label: c.label, storeName: c.storeName, deviceSerial: c.deviceSerial };
    }

    async getCamera(cameraId: string) {
        const c = this.cameras.get(cameraId);
        return c ? this.owner(c) : null;
    }

    async findCameraBySerial(serial: string) {
        const c = [...this.cameras.values()].find((x) => x.deviceSerial === serial);
        return c ? this.owner(c) : null;
    }

    async countMappedCameras(contractorId: string) {
        return [...this.cameras.values()].filter((c) => c.contractorId === contractorId && c.deviceSerial).length;
    }

    async setCameraSerial(cameraId: string, serial: string | null) {
        this.cameras.get(cameraId)!.deviceSerial = serial;
    }

    async audit(entry: AuditEntry) {
        this.audits.push(entry);
    }
}
