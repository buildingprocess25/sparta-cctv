import "server-only";
import type { AdminStore, AuditEntry, CameraOwner, ContractorCamera, ContractorOverview, StoreSummary } from "./admin-store";
import { PrismaAccountStore } from "./prisma-account-store";

// Prisma dimuat saat dipakai agar mode mock tidak membutuhkan DATABASE_URL.
async function db() {
    return (await import("@/lib/prisma")).default;
}

type ContractorRow = {
    id: string;
    name: string;
    ezvizAccount: {
        id: string;
        appKey: string;
        status: "ACTIVE" | "TOKEN_ERROR" | "DISABLED";
        tokenExpiresAt: Date | null;
        areaDomain: string | null;
        deviceLimit: number;
        lastError: string | null;
        lastErrorAt: Date | null;
        lastTokenRefreshAt: Date | null;
    } | null;
    stores: { cameras: { deviceSerial: string | null }[] }[];
};

function toOverview(c: ContractorRow): ContractorOverview {
    const cameras = c.stores.flatMap((s) => s.cameras);
    const a = c.ezvizAccount;
    return {
        contractorId: c.id,
        contractorName: c.name,
        account: a && {
            id: a.id,
            appKey: a.appKey,
            status: a.status,
            tokenExpiresAt: a.tokenExpiresAt,
            areaDomain: a.areaDomain,
            deviceLimit: a.deviceLimit,
            lastError: a.lastError,
            lastErrorAt: a.lastErrorAt,
            lastTokenRefreshAt: a.lastTokenRefreshAt,
        },
        mappedDevices: cameras.filter((x) => x.deviceSerial).length,
        cameraCount: cameras.length,
    };
}

const contractorInclude = {
    ezvizAccount: true,
    stores: { select: { cameras: { select: { deviceSerial: true } } } },
} as const;

/** Penyimpanan admin di PostgreSQL (memperluas penyimpanan akun yang dipakai TokenManager). */
export class PrismaAdminStore extends PrismaAccountStore implements AdminStore {
    async listContractors(): Promise<ContractorOverview[]> {
        const rows = await (await db()).contractor.findMany({ orderBy: { name: "asc" }, include: contractorInclude });
        return rows.map(toOverview);
    }

    async getContractor(contractorId: string): Promise<ContractorOverview | null> {
        const row = await (await db()).contractor.findUnique({ where: { id: contractorId }, include: contractorInclude });
        return row ? toOverview(row) : null;
    }

    async listContractorCameras(contractorId: string): Promise<ContractorCamera[]> {
        const rows = await (await db()).camera.findMany({
            where: { store: { contractorId } },
            include: { store: { select: { id: true, name: true, code: true } } },
            orderBy: [{ store: { name: "asc" } }, { label: "asc" }],
        });
        return rows.map((c) => ({
            id: c.id,
            label: c.label,
            area: c.area,
            storeId: c.store.id,
            storeName: c.store.name,
            storeCode: c.store.code,
            deviceSerial: c.deviceSerial,
        }));
    }

    async listStoresByContractor(contractorId: string): Promise<StoreSummary[]> {
        const rows = await (await db()).store.findMany({
            where: { contractorId },
            select: { id: true, name: true, code: true },
            orderBy: { name: "asc" },
        });
        return rows;
    }

    async createAccount(input: { id: string; contractorId: string; appKey: string; appSecretEnc: string }): Promise<void> {
        await (await db()).ezvizAccount.create({ data: input });
    }

    async updateCredentials(accountId: string, input: { appKey: string; appSecretEnc?: string }): Promise<void> {
        const prisma = await db();
        const current = await prisma.ezvizAccount.findUnique({ where: { id: accountId }, select: { status: true } });
        await prisma.ezvizAccount.update({
            where: { id: accountId },
            data: {
                appKey: input.appKey,
                ...(input.appSecretEnc ? { appSecretEnc: input.appSecretEnc } : {}),
                // Token lama dibuat dengan kredensial sebelumnya.
                accessTokenEnc: null,
                tokenExpiresAt: null,
                areaDomain: null,
                lastError: null,
                lastErrorAt: null,
                status: current?.status === "DISABLED" ? "DISABLED" : "ACTIVE",
            },
        });
    }

    async setAccountStatus(accountId: string, status: "ACTIVE" | "DISABLED"): Promise<void> {
        await (await db()).ezvizAccount.update({ where: { id: accountId }, data: { status } });
    }

    private async owner(where: { id: string } | { deviceSerial: string }): Promise<CameraOwner | null> {
        const c = await (await db()).camera.findUnique({
            where,
            include: { store: { select: { contractorId: true, name: true } } },
        });
        return c && { id: c.id, contractorId: c.store.contractorId, label: c.label, storeName: c.store.name, deviceSerial: c.deviceSerial };
    }

    getCamera(cameraId: string) {
        return this.owner({ id: cameraId });
    }

    findCameraBySerial(serial: string) {
        return this.owner({ deviceSerial: serial });
    }

    async countMappedCameras(contractorId: string): Promise<number> {
        return (await db()).camera.count({ where: { deviceSerial: { not: null }, store: { contractorId } } });
    }

    async setCameraSerial(cameraId: string, serial: string | null): Promise<void> {
        // Perangkat berbeda → keadaan pemantauan lama tidak berlaku lagi (riwayat event tetap disimpan).
        await (await db()).camera.update({
            where: { id: cameraId },
            data: {
                deviceSerial: serial,
                status: "UNKNOWN",
                statusSince: null,
                lastCheckedAt: null,
                disconnectsToday: 0,
                uptime7d: null,
                sdCheckedAt: null,
                snapshotPath: null,
                snapshotAt: null,
                snapshotTriedAt: null,
            },
        });
    }

    async createCamera(input: { storeId: string; label: string; area: string }): Promise<ContractorCamera> {
        const c = await (await db()).camera.create({
            data: { storeId: input.storeId, label: input.label, area: input.area },
            include: { store: { select: { id: true, name: true, code: true } } },
        });
        return {
            id: c.id,
            label: c.label,
            area: c.area,
            storeId: c.store.id,
            storeName: c.store.name,
            storeCode: c.store.code,
            deviceSerial: c.deviceSerial,
        };
    }

    async audit(entry: AuditEntry): Promise<void> {
        await (await db()).auditLog.create({
            data: { action: entry.action, entity: entry.entity, entityId: entry.entityId ?? null, detail: entry.detail ?? null },
        });
    }
}
