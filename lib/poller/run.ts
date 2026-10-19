import "server-only";
import { getEzvizRuntime } from "@/lib/cameras";
import { refreshDueTokens, type RefreshJobResult } from "@/lib/ezviz/token-refresh-job";
import { PrismaPollerStore } from "./prisma-poller-store";
import { pollAllAccounts, type PollSummary } from "./poller";
import { FsSnapshotStorage, snapshotDir } from "./snapshot-storage";

// Pemicu untuk endpoint cron. Satu proses server di VPS → penjaga tumpang tindih cukup di memori.

declare const globalThis: { pollRunning?: boolean; refreshRunning?: boolean } & typeof global;

export type RunOutcome<T> = { skipped: "busy" } | { skipped?: undefined; result: T; durationMs: number };

async function exclusive<T>(flag: "pollRunning" | "refreshRunning", fn: () => Promise<T>): Promise<RunOutcome<T>> {
    if (globalThis[flag]) return { skipped: "busy" };
    globalThis[flag] = true;
    const started = Date.now();
    try {
        return { result: await fn(), durationMs: Date.now() - started };
    } finally {
        globalThis[flag] = false;
    }
}

export function runPollCycle(): Promise<RunOutcome<PollSummary>> {
    return exclusive("pollRunning", () =>
        pollAllAccounts({
            store: new PrismaPollerStore(),
            gateway: getEzvizRuntime().gateway,
            snapshots: new FsSnapshotStorage(snapshotDir()),
        }),
    );
}

export function runTokenRefresh(): Promise<RunOutcome<RefreshJobResult[]>> {
    return exclusive("refreshRunning", () => {
        const { store, tokens } = getEzvizRuntime();
        return refreshDueTokens({ store, tokens });
    });
}
