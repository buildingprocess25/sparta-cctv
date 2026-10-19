import { ChevronRight, HardDrive, KeyRound, Phone, TriangleAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { SD_LABEL } from "@/components/dashboard/camera-tile";
import { formatTime } from "@/lib/format";
import type { AlertView } from "@/lib/monitoring";
import { cn } from "@/lib/utils";

function describe(alert: AlertView) {
    if (alert.kind === "offline") {
        return { title: `Offline sejak ${alert.since ? formatTime(alert.since) : "-"}`, Icon: WifiOff, tone: "text-status-offline" };
    }
    if (alert.kind === "unstable") {
        return { title: `Putus ${alert.disconnectsToday}× hari ini`, Icon: TriangleAlert, tone: "text-status-warning" };
    }
    if (alert.kind === "account") {
        return {
            title: alert.accountState === "DISABLED" ? "Akun EZVIZ dinonaktifkan" : "Akun EZVIZ bermasalah",
            Icon: KeyRound,
            tone: "text-status-warning",
        };
    }
    return { title: SD_LABEL[alert.sdStatus], Icon: HardDrive, tone: "text-status-warning" };
}

/** Ringkasan "Perlu ditindak" untuk mobile: 2 item teratas + tautan ke semua. */
export function MobileAlertCard({ alerts }: { alerts: AlertView[] }) {
    if (alerts.length === 0) return null;

    return (
        <section className="flex flex-col rounded-xl border bg-card px-4 pt-3.5 pb-1 lg:hidden">
            <header className="flex items-center justify-between pb-2.5">
                <h2 className="text-[14.5px] font-semibold">Perlu ditindak</h2>
                <Link href="/perlu-ditindak" className="flex items-center gap-0.5 text-[12.5px] font-semibold text-primary">
                    Lihat {alerts.length}
                    <ChevronRight className="size-3.5" />
                </Link>
            </header>
            <ul>
                {alerts.slice(0, 2).map((alert) => {
                    const { title, Icon, tone } = describe(alert);
                    return (
                        <li key={`${alert.kind}-${alert.id}`} className="flex items-start gap-3 border-t py-3">
                            <Icon className={cn("mt-0.5 size-[17px] shrink-0", tone)} />
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <p className={cn("text-[13px] font-semibold", tone)}>{title}</p>
                                <p className="truncate text-xs font-medium text-muted-foreground">
                                    {alert.kind === "account"
                                        ? `${alert.contractorName} · ${alert.unknownCount} kamera`
                                        : `${alert.cameraLabel} · ${alert.storeName}`}
                                </p>
                            </div>
                            {alert.contractorPhone ? (
                                <a
                                    href={`tel:${alert.contractorPhone.replace(/[^\d+]/g, "")}`}
                                    aria-label={`Hubungi ${alert.contractorName}`}
                                    className="shrink-0 text-primary"
                                >
                                    <Phone className="size-4" />
                                </a>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
