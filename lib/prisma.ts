import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

function parsePositiveInteger(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const prismaClientSingleton = () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL environment variable is not set");
    }

    const pool = new Pool({
        connectionString: databaseUrl,
        max: parsePositiveInteger(process.env.DATABASE_POOL_MAX, 10),
        idleTimeoutMillis: parsePositiveInteger(
            process.env.DATABASE_IDLE_TIMEOUT_MS,
            10000,
        ),
        connectionTimeoutMillis: parsePositiveInteger(
            process.env.DATABASE_CONNECTION_TIMEOUT_MS,
            10000,
        ),
        allowExitOnIdle: true,
        options: "-c timezone=UTC",
    });

    return new PrismaClient({
        adapter: new PrismaPg(pool),
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
};

declare const globalThis: {
    prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
