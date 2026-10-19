import { getDataSource } from "@/lib/cameras";
import { checkCronAuth } from "@/lib/cron-auth";
import { runTokenRefresh } from "@/lib/poller/run";

export const dynamic = "force-dynamic";

// Dipanggil crontab tiap hari:
//   15 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ezviz-refresh-tokens
async function handle(request: Request) {
    const denied = checkCronAuth(request);
    if (denied) return denied;
    if (getDataSource() !== "ezviz") {
        return Response.json({ skipped: "CAMERA_DATA_SOURCE bukan ezviz" });
    }

    const outcome = await runTokenRefresh();
    if (outcome.skipped) return Response.json({ skipped: outcome.skipped }, { status: 409 });
    return Response.json({ durationMs: outcome.durationMs, results: outcome.result });
}

export const GET = handle;
export const POST = handle;
