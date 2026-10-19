import "server-only";
import { EzvizClient } from "@/lib/ezviz/client";
import { PrismaAccountStore } from "@/lib/ezviz/prisma-account-store";
import { TokenManager } from "@/lib/ezviz/token-manager";
import { EzvizGateway } from "./ezviz-gateway";
import type { CameraGateway } from "./gateway";
import { MockGateway } from "./mock-gateway";

export type DataSource = "mock" | "db" | "ezviz";

export function getDataSource(): DataSource {
    const value = process.env.CAMERA_DATA_SOURCE;
    return value === "db" || value === "ezviz" ? value : "mock";
}

type EzvizRuntime = { store: PrismaAccountStore; client: EzvizClient; tokens: TokenManager; gateway: EzvizGateway };

declare const globalThis: { ezvizRuntime?: EzvizRuntime; cameraGateway?: CameraGateway } & typeof global;

// Singleton disimpan di globalThis agar bertahan saat HMR. Cek instanceof memastikan instance
// dibuat ulang bila kodenya berubah (kelas baru setelah hot reload), bukan memakai versi lama.

/** Komponen EZVIZ (satu instance per proses). Dibuat saat pertama dipakai. */
export function getEzvizRuntime(): EzvizRuntime {
    if (!(globalThis.ezvizRuntime?.gateway instanceof EzvizGateway)) {
        const store = new PrismaAccountStore();
        const client = new EzvizClient({
            tokenBaseUrl: process.env.EZVIZ_TOKEN_BASE_URL ?? "https://open.ezvizlife.com",
        });
        const tokens = new TokenManager({ store, client });
        globalThis.ezvizRuntime = { store, client, tokens, gateway: new EzvizGateway({ client, tokens }) };
    }
    return globalThis.ezvizRuntime;
}

/** Gateway sesuai CAMERA_DATA_SOURCE. Mode "db" tetap memakai data contoh untuk live/rekaman. */
export function getGateway(): CameraGateway {
    if (getDataSource() === "ezviz") return getEzvizRuntime().gateway;
    if (!(globalThis.cameraGateway instanceof MockGateway)) globalThis.cameraGateway = new MockGateway();
    return globalThis.cameraGateway;
}
