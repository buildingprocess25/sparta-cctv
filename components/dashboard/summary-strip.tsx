import type { DashboardData } from "@/lib/monitoring";
import { cn } from "@/lib/utils";

export function SummaryStrip({ stats }: { stats: DashboardData["stats"] }) {
    const items = [
        { label: "Kamera online", value: stats.online, suffix: `/ ${stats.total}` },
        { label: "Offline", value: stats.offline, tone: stats.offline > 0 ? "text-status-offline" : "" },
        { label: "Tidak stabil", value: stats.unstable, tone: stats.unstable > 0 ? "text-status-warning" : "" },
        { label: "MicroSD bermasalah", value: stats.sdProblems, tone: stats.sdProblems > 0 ? "text-status-warning" : "" },
        { label: "Toko dipantau", value: stats.stores },
    ];
    const needCheck = stats.unstable + stats.sdProblems + stats.unknown;

    return (
        <>
            {/* Mobile: 3 metrik ringkas */}
            <dl className="grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-card lg:hidden">
                <div className="flex flex-col gap-px px-3.5 py-2.5">
                    <dt className="text-xs font-medium text-muted-foreground">Online</dt>
                    <dd className="flex items-baseline gap-0.5">
                        <span className="text-lg font-semibold">{stats.online}</span>
                        <span className="text-[13px] font-medium text-subtle">/{stats.total}</span>
                    </dd>
                </div>
                <div className="flex flex-col gap-px px-3.5 py-2.5">
                    <dt className="text-xs font-medium text-muted-foreground">Offline</dt>
                    <dd className={cn("text-lg font-semibold", stats.offline > 0 && "text-status-offline")}>
                        {stats.offline}
                    </dd>
                </div>
                <div className="flex flex-col gap-px px-3.5 py-2.5">
                    <dt className="text-xs font-medium text-muted-foreground">Perlu cek</dt>
                    <dd className={cn("text-lg font-semibold", needCheck > 0 && "text-status-warning")}>
                        {needCheck}
                    </dd>
                </div>
            </dl>

            <dl className="hidden grid-cols-5 divide-x overflow-hidden rounded-xl border bg-card lg:grid">
                {items.map((item) => (
                    <div key={item.label} className="flex flex-col gap-0.5 px-5 py-3.5">
                        <dt className="text-[12.5px] font-medium text-muted-foreground">{item.label}</dt>
                        <dd className="flex items-baseline gap-0.5">
                            <span className={cn("text-xl font-semibold", item.tone)}>{item.value}</span>
                            {item.suffix ? (
                                <span className="text-sm font-medium text-subtle"> {item.suffix}</span>
                            ) : null}
                        </dd>
                    </div>
                ))}
            </dl>
        </>
    );
}
