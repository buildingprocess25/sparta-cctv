import { Suspense } from "react";
import { AlertPanel } from "@/components/dashboard/alert-panel";
import { DashboardFilters } from "@/components/dashboard/filters";
import { MobileAlertCard } from "@/components/dashboard/mobile-alert-card";
import { SearchBox } from "@/components/dashboard/search-box";
import { StoreCard } from "@/components/dashboard/store-card";
import { SummaryStrip } from "@/components/dashboard/summary-strip";
import { MobileAppBar } from "@/components/layout/mobile-app-bar";
import { Page } from "@/components/layout/page";
import { formatCompactDate, formatLongDate } from "@/lib/format";
import { getDashboardData, type StatusFilter } from "@/lib/monitoring";

const STATUS_VALUES = ["all", "online", "offline", "unstable", "unknown", "sd"];

type SearchParams = Promise<{ q?: string; kontraktor?: string; status?: string }>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
    const { q, kontraktor, status } = await searchParams;
    const data = await getDashboardData({
        q,
        contractor: kontraktor,
        status: STATUS_VALUES.includes(status ?? "") ? (status as StatusFilter) : "all",
    });
    const now = new Date();

    return (
        <>
            <MobileAppBar hasAlerts={data.alerts.length > 0} />
            <Page className="gap-4 lg:gap-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-col gap-[3px] lg:gap-1">
                        <h1 className="text-xl font-bold lg:text-2xl">Monitoring proyek</h1>
                        <p className="text-[13px] font-medium text-muted-foreground lg:text-[13.5px]">
                            <span className="lg:hidden">
                                {data.stats.stores} toko · {formatCompactDate(now)}
                            </span>
                            <span className="hidden lg:inline">
                                {data.stats.stores} toko dalam pembangunan · {formatLongDate(now)}
                            </span>
                        </p>
                    </div>
                    <div className="max-lg:hidden">
                        <Suspense>
                            <DashboardFilters contractors={data.contractors} />
                        </Suspense>
                    </div>
                </div>

                <Suspense>
                    <SearchBox className="max-w-none border bg-white lg:hidden" />
                </Suspense>

                <SummaryStrip stats={data.stats} />
                <MobileAlertCard alerts={data.alerts} />

                <div className="flex items-center justify-between lg:hidden">
                    <h2 className="text-[15px] font-semibold">Toko</h2>
                    <Suspense>
                        <DashboardFilters contractors={data.contractors} compact />
                    </Suspense>
                </div>

                <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_352px]">
                    <div className="flex flex-col gap-4">
                        {data.stores.length === 0 ? (
                            <p className="rounded-xl border bg-card p-10 text-center text-[13px] font-medium text-muted-foreground">
                                Tidak ada toko yang cocok dengan filter.
                            </p>
                        ) : (
                            data.stores.map((store) => <StoreCard key={store.id} store={store} now={now} />)
                        )}
                    </div>
                    <AlertPanel alerts={data.alerts} />
                </div>
            </Page>
        </>
    );
}
