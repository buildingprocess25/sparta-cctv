import "server-only";
import { getEzvizRuntime } from "@/lib/cameras";
import { AdminService } from "./admin-service";
import { PrismaAdminStore } from "./prisma-admin-store";

export type AdminRuntime = { store: PrismaAdminStore; service: AdminService };

declare const globalThis: { adminRuntime?: AdminRuntime } & typeof global;

export function getAdminRuntime(): AdminRuntime {
    if (!globalThis.adminRuntime) {
        const { client, tokens } = getEzvizRuntime();
        const store = new PrismaAdminStore();
        globalThis.adminRuntime = { store, service: new AdminService({ store, tokens, client }) };
    }
    return globalThis.adminRuntime;
}
