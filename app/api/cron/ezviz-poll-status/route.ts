import { getDataSource } from "@/lib/cameras";
import { checkCronAuth } from "@/lib/cron-auth";
import { runPollCycle } from "@/lib/poller/run";

export const dynamic = "force-dynamic";

// Dipanggil crontab tiap 5 menit:
//   */5 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ezviz-poll-status
async function handle(request: Request) {
    const denied = checkCronAuth(request);
    if (denied) return denied;
    if (getDataSource() !== "ezviz") {
        return Response.json({ skipped: "CAMERA_DATA_SOURCE bukan ezviz" });
    }

    const outcome = await runPollCycle();
    if (outcome.skipped) return Response.json({ skipped: outcome.skipped }, { status: 409 });

    const { result, durationMs } = outcome;
    return Response.json({
        durationMs,
        accounts: result.accounts,
        checked: result.results.reduce((n, r) => n + r.checked, 0),
        changed: result.results.reduce((n, r) => n + r.changed, 0),
        snapshots: result.results.reduce((n, r) => n + r.snapshots, 0),
        withError: result.results.filter((r) => r.error).map((r) => ({ accountId: r.accountId, error: r.error })),
        rateLimited: result.results.filter((r) => r.rateLimited).map((r) => r.accountId),
        crashed: result.crashed,
    });
}

export const GET = handle;
export const POST = handle;
