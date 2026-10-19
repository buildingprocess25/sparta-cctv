import { Suspense } from "react";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getDashboardData } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const { alerts, lastCheckedAt } = await getDashboardData();

    return (
        <div className="flex min-h-screen">
            <Sidebar alertCount={alerts.length} />
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="hidden lg:block">
                    <Suspense fallback={<div className="h-[63px] border-b bg-white" />}>
                        <Topbar lastCheckedAt={lastCheckedAt} hasAlerts={alerts.length > 0} />
                    </Suspense>
                </div>
                <main className="flex flex-1 flex-col">{children}</main>
                <BottomNav alertCount={alerts.length} />
            </div>
        </div>
    );
}
