import { randomUUID } from "node:crypto";
import { encryptSecret } from "@/lib/crypto";
import type { AdminStore, ContractorCamera } from "./admin-store";
import type { EzvizClient } from "./client";
import {
    AccountUnavailableError,
    CredentialError,
    DeviceNotFoundError,
    EzvizError,
    RateLimitError,
    TokenExpiredError,
    TransientError,
} from "./errors";
import type { TokenManager } from "./token-manager";
import type { EzvizDevice } from "./types";

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export const DEFAULT_DEVICE_LIMIT = 10;
const SERIAL = /^[A-Z0-9]{6,20}$/;
const APP_KEY = /^\S{1,100}$/;

// ---------------------------------------------------------------------------
// Pesan error yang ramah pengguna (tanpa secret/token)
// ---------------------------------------------------------------------------

export function describeError(error: unknown): string {
    if (error instanceof CredentialError) {
        switch (error.code) {
            case 10017:
                return "appKey tidak ditemukan di EZVIZ. Periksa kembali appKey.";
            case 10030:
                return "appKey dan appSecret tidak cocok.";
            case 10005:
                return "appKey dibekukan oleh EZVIZ. Hubungi kontraktor/EZVIZ.";
            default:
                return "Kredensial EZVIZ tidak valid.";
        }
    }
    if (error instanceof AccountUnavailableError) {
        if (error.reason === "DISABLED") return "Akun EZVIZ sedang dinonaktifkan.";
        if (error.reason === "NOT_FOUND") return "Akun EZVIZ belum dibuat untuk kontraktor ini.";
        return "Akun EZVIZ bermasalah. Perbarui kredensial lalu uji koneksi.";
    }
    if (error instanceof TokenExpiredError) return "Token ditolak EZVIZ meski sudah diperbarui.";
    if (error instanceof RateLimitError) return "Batas panggilan EZVIZ tercapai. Coba lagi beberapa saat.";
    if (error instanceof TransientError) return "Gagal menghubungi EZVIZ. Coba lagi beberapa saat.";
    if (error instanceof DeviceNotFoundError) return "Perangkat tidak ditemukan di akun EZVIZ.";
    if (error instanceof EzvizError) return `Kesalahan dari EZVIZ: ${error.message}`;
    return "Terjadi kesalahan tak terduga.";
}

// ---------------------------------------------------------------------------
// Perbandingan perangkat EZVIZ dengan kamera di sistem
// ---------------------------------------------------------------------------

export type DeviceDiff = {
    matched: { deviceSerial: string; deviceName: string; online: boolean | null; cameraId: string; label: string; storeName: string }[];
    /** ada di akun EZVIZ tetapi belum dipetakan ke kamera mana pun */
    onlyInEzviz: { deviceSerial: string; deviceName: string }[];
    /** sudah dipetakan di sistem tetapi tidak ada (lagi) di akun EZVIZ */
    onlyInSystem: { cameraId: string; label: string; storeName: string; deviceSerial: string }[];
    /** kamera tanpa serial */
    unmappedCameras: number;
};

export function diffDevices(devices: Pick<EzvizDevice, "deviceSerial" | "deviceName" | "status">[], cameras: ContractorCamera[]): DeviceDiff {
    const norm = (s: string) => s.trim().toUpperCase();
    const bySerial = new Map(cameras.filter((c) => c.deviceSerial).map((c) => [norm(c.deviceSerial!), c]));
    const ezvizSerials = new Set(devices.map((d) => norm(d.deviceSerial)));

    const diff: DeviceDiff = { matched: [], onlyInEzviz: [], onlyInSystem: [], unmappedCameras: cameras.filter((c) => !c.deviceSerial).length };
    for (const d of devices) {
        const camera = bySerial.get(norm(d.deviceSerial));
        if (camera) {
            diff.matched.push({
                deviceSerial: norm(d.deviceSerial),
                deviceName: d.deviceName,
                online: d.status === 1 ? true : d.status === 0 ? false : null,
                cameraId: camera.id,
                label: camera.label,
                storeName: camera.storeName,
            });
        } else {
            diff.onlyInEzviz.push({ deviceSerial: norm(d.deviceSerial), deviceName: d.deviceName });
        }
    }
    for (const c of cameras) {
        if (c.deviceSerial && !ezvizSerials.has(norm(c.deviceSerial))) {
            diff.onlyInSystem.push({ cameraId: c.id, label: c.label, storeName: c.storeName, deviceSerial: norm(c.deviceSerial) });
        }
    }
    return diff;
}

// ---------------------------------------------------------------------------
// Layanan admin
// ---------------------------------------------------------------------------

export type AdminServiceDeps = {
    store: AdminStore;
    tokens: TokenManager;
    client: EzvizClient;
    /** kunci enkripsi; bawaan dari env */
    key?: Buffer;
    newId?: () => string;
};

export class AdminService {
    private readonly store: AdminStore;
    private readonly tokens: TokenManager;
    private readonly client: EzvizClient;
    private readonly key?: Buffer;
    private readonly newId: () => string;

    constructor(deps: AdminServiceDeps) {
        this.store = deps.store;
        this.tokens = deps.tokens;
        this.client = deps.client;
        this.key = deps.key;
        this.newId = deps.newId ?? (() => randomUUID().replace(/-/g, ""));
    }

    /** Tambah akun (appSecret wajib) atau ubah kredensial (appSecret kosong = tidak diganti). */
    async saveAccount(contractorId: string, input: { appKey: string; appSecret?: string }): Promise<Result<{ accountId: string; created: boolean; changed: boolean }>> {
        const appKey = input.appKey.trim();
        const appSecret = input.appSecret?.trim() ? input.appSecret.trim() : undefined;
        if (!APP_KEY.test(appKey)) return { ok: false, error: "appKey wajib diisi (tanpa spasi, maksimal 100 karakter)." };
        if (appSecret && appSecret.length > 200) return { ok: false, error: "appSecret terlalu panjang." };

        const contractor = await this.store.getContractor(contractorId);
        if (!contractor) return { ok: false, error: "Kontraktor tidak ditemukan." };

        const existing = contractor.account;
        if (!existing) {
            if (!appSecret) return { ok: false, error: "appSecret wajib diisi untuk akun baru." };
            const id = this.newId();
            await this.store.createAccount({
                id,
                contractorId,
                appKey,
                appSecretEnc: encryptSecret(appSecret, { key: this.key, aad: `${id}:appSecret` }),
            });
            await this.store.audit({ action: "ezviz.account.create", entity: "EzvizAccount", entityId: id, detail: `kontraktor ${contractor.contractorName}` });
            return { ok: true, accountId: id, created: true, changed: true };
        }

        if (appKey === existing.appKey && !appSecret) {
            return { ok: true, accountId: existing.id, created: false, changed: false };
        }
        await this.store.updateCredentials(existing.id, {
            appKey,
            ...(appSecret ? { appSecretEnc: encryptSecret(appSecret, { key: this.key, aad: `${existing.id}:appSecret` }) } : {}),
        });
        await this.store.audit({
            action: "ezviz.account.update",
            entity: "EzvizAccount",
            entityId: existing.id,
            detail: [appKey !== existing.appKey ? "appKey diubah" : null, appSecret ? "appSecret diganti" : null].filter(Boolean).join(", "),
        });
        return { ok: true, accountId: existing.id, created: false, changed: true };
    }

    /** Minta token baru dan ambil daftar perangkat: membuktikan kredensial benar. */
    async testConnection(contractorId: string): Promise<Result<{ deviceCount: number; overLimit: boolean; tokenExpiresAt: Date; areaDomain: string }>> {
        const contractor = await this.store.getContractor(contractorId);
        if (!contractor?.account) return { ok: false, error: "Akun EZVIZ belum dibuat untuk kontraktor ini." };
        const account = contractor.account;

        try {
            const ctx = await this.tokens.refresh(account.id, { force: true });
            const devices = await this.client.listDevices(ctx.areaDomain, ctx.accessToken);
            await this.store.audit({ action: "ezviz.account.test", entity: "EzvizAccount", entityId: account.id, detail: `berhasil, ${devices.length} perangkat` });
            return { ok: true, deviceCount: devices.length, overLimit: devices.length > account.deviceLimit, tokenExpiresAt: ctx.expiresAt, areaDomain: ctx.areaDomain };
        } catch (error) {
            return { ok: false, error: describeError(error) };
        }
    }

    /** Bandingkan perangkat di akun EZVIZ dengan kamera yang dipetakan di sistem. */
    async syncDevices(contractorId: string): Promise<Result<{ diff: DeviceDiff; deviceCount: number; overLimit: boolean }>> {
        const contractor = await this.store.getContractor(contractorId);
        if (!contractor?.account) return { ok: false, error: "Akun EZVIZ belum dibuat untuk kontraktor ini." };
        const account = contractor.account;

        try {
            const devices = await this.tokens.withToken(account.id, (ctx) => this.client.listDevices(ctx.areaDomain, ctx.accessToken));
            const cameras = await this.store.listContractorCameras(contractorId);
            return { ok: true, diff: diffDevices(devices, cameras), deviceCount: devices.length, overLimit: devices.length > account.deviceLimit };
        } catch (error) {
            return { ok: false, error: describeError(error) };
        }
    }

    async setAccountEnabled(contractorId: string, enabled: boolean): Promise<Result<object>> {
        const contractor = await this.store.getContractor(contractorId);
        if (!contractor?.account) return { ok: false, error: "Akun EZVIZ belum dibuat untuk kontraktor ini." };
        await this.store.setAccountStatus(contractor.account.id, enabled ? "ACTIVE" : "DISABLED");
        await this.store.audit({
            action: enabled ? "ezviz.account.enable" : "ezviz.account.disable",
            entity: "EzvizAccount",
            entityId: contractor.account.id,
        });
        return { ok: true };
    }

    /** Petakan/lepas serial perangkat pada satu kamera; menegakkan keunikan dan batas device per akun. */
    async mapCameraSerial(cameraId: string, rawSerial: string): Promise<Result<{ serial: string | null; changed: boolean }>> {
        const camera = await this.store.getCamera(cameraId);
        if (!camera) return { ok: false, error: "Kamera tidak ditemukan." };

        const serial = rawSerial.trim().toUpperCase() || null;
        if (serial && !SERIAL.test(serial)) return { ok: false, error: "Serial tidak valid (6–20 huruf/angka, tanpa spasi)." };
        if (serial === camera.deviceSerial) return { ok: true, serial, changed: false };

        if (serial) {
            const owner = await this.store.findCameraBySerial(serial);
            if (owner && owner.id !== cameraId) {
                return { ok: false, error: `Serial sudah dipakai kamera ${owner.label} di ${owner.storeName}.` };
            }
            // Mengganti serial pada kamera yang sudah terpetakan tidak menambah jumlah device.
            if (!camera.deviceSerial) {
                const contractor = await this.store.getContractor(camera.contractorId);
                const limit = contractor?.account?.deviceLimit ?? DEFAULT_DEVICE_LIMIT;
                const mapped = await this.store.countMappedCameras(camera.contractorId);
                if (mapped >= limit) {
                    return { ok: false, error: `Batas ${limit} perangkat per akun sudah tercapai.` };
                }
            }
        }

        await this.store.setCameraSerial(cameraId, serial);
        await this.store.audit({
            action: serial ? "camera.serial.set" : "camera.serial.clear",
            entity: "Camera",
            entityId: cameraId,
            detail: `${camera.label} · ${camera.storeName}${serial ? ` → ${serial}` : ""}`,
        });
        return { ok: true, serial, changed: true };
    }

    /** Simpan banyak serial sekaligus. Pelepasan diproses lebih dulu agar slot batas terbebas. */
    async mapCameraSerials(entries: { cameraId: string; serial: string }[]): Promise<{ cameraId: string; result: Result<{ serial: string | null; changed: boolean }> }[]> {
        const ordered = [...entries].sort((a, b) => Number(Boolean(a.serial.trim())) - Number(Boolean(b.serial.trim())));
        const out: { cameraId: string; result: Result<{ serial: string | null; changed: boolean }> }[] = [];
        for (const entry of ordered) {
            out.push({ cameraId: entry.cameraId, result: await this.mapCameraSerial(entry.cameraId, entry.serial) });
        }
        return out;
    }

    /**
     * Tambah kamera baru ke toko milik kontraktor.
     * Validasi: label unik per toko, storeId harus milik kontraktor yang sama.
     */
    async addCamera(
        contractorId: string,
        input: { storeId: string; label: string; area: string },
    ): Promise<Result<{ camera: ContractorCamera }>> {
        const label = input.label.trim().toUpperCase();
        const area = input.area.trim();
        if (!label) return { ok: false, error: "Label kamera wajib diisi." };
        if (label.length > 20) return { ok: false, error: "Label terlalu panjang (maks. 20 karakter)." };
        if (!area) return { ok: false, error: "Area kamera wajib diisi." };
        if (area.length > 100) return { ok: false, error: "Area terlalu panjang (maks. 100 karakter)." };

        // Pastikan storeId milik kontraktor ini
        const stores = await this.store.listStoresByContractor(contractorId);
        const store = stores.find((s) => s.id === input.storeId);
        if (!store) return { ok: false, error: "Toko tidak ditemukan atau bukan milik kontraktor ini." };

        // Cek label unik dalam toko
        const existing = await this.store.listContractorCameras(contractorId);
        const duplicate = existing.find((c) => c.storeId === input.storeId && c.label.toUpperCase() === label);
        if (duplicate) return { ok: false, error: `Label "${label}" sudah ada di toko ini.` };

        const camera = await this.store.createCamera({ storeId: input.storeId, label, area });
        await this.store.audit({
            action: "camera.create",
            entity: "Camera",
            entityId: camera.id,
            detail: `${label} · ${area} · ${store.name}`,
        });
        return { ok: true, camera };
    }

    /** Hapus kamera; hanya boleh jika kamera milik kontraktor yang sama. */
    async removeCamera(contractorId: string, cameraId: string): Promise<Result<object>> {
        const camera = await this.store.getCamera(cameraId);
        if (!camera) return { ok: false, error: "Kamera tidak ditemukan." };
        if (camera.contractorId !== contractorId) return { ok: false, error: "Kamera bukan milik kontraktor ini." };

        const deleted = await this.store.deleteCamera(cameraId);
        if (!deleted) return { ok: false, error: "Kamera gagal dihapus." };

        await this.store.audit({
            action: "camera.delete",
            entity: "Camera",
            entityId: cameraId,
            detail: `${camera.label} · ${camera.storeName}`,
        });
        return { ok: true };
    }
}
