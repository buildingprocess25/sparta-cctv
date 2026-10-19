import { HardDrive, KeyRound, Phone, TriangleAlert, WifiOff } from "lucide-react";
import { SD_LABEL } from "@/components/dashboard/camera-tile";
import { formatTime } from "@/lib/format";
import type { AlertView } from "@/lib/monitoring";
import { cn } from "@/lib/utils";

function describe(alert: AlertView) {
    switch (alert.kind) {
        case "offline":
            return {
                title: `Offline sejak ${alert.since ? formatTime(alert.since) : "-"}`,
                Icon: WifiOff,
                tone: "text-status-offline",
            };
        case "unstable":
            return {
                title: `Putus ${alert.disconnectsToday}× hari ini`,
                Icon: TriangleAlert,
                tone: "text-status-warning",
            };
        case "account":
            return {
                title: alert.accountState === "DISABLED" ? "Akun EZVIZ dinonaktifkan" : "Akun EZVIZ bermasalah",
                Icon: KeyRound,
                tone: "text-status-warning",
            };
        default:
            return {
                title: SD_LABEL[alert.sdStatus],
                Icon: HardDrive,
                tone: "text-status-warning",
            };
    }
}

export function AlertPanel({ alerts }: { alerts: AlertView[] }) {
    return (
        <aside className="hidden flex-col rounded-xl border bg-card px-5 pt-[18px] pb-4 lg:sticky lg:top-[88px] lg:flex lg:self-start">
            <div className="flex items-center gap-2 pb-1.5">
                <h2 className="text-[15px] font-semibold">Perlu ditindak</h2>
                <span className="rounded-full bg-alert-badge/10 px-[7px] py-px text-xs font-bold text-status-offline">
                    {alerts.length}
                </span>
            </div>
            {alerts.length === 0 ? (
                <p className="border-t py-6 text-center text-[13px] font-medium text-muted-foreground">
                    Semua kamera dalam kondisi baik.
                </p>
            ) : (
                <ul>
                    {alerts.map((alert) => {
                        const { title, Icon, tone } = describe(alert);
                        return (
                            <li key={`${alert.kind}-${alert.id}`} className="flex items-start gap-3 border-t py-3.5">
                                <Icon className={cn("mt-0.5 size-[17px] shrink-0", tone)} />
                                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                    <p className={cn("text-[13.5px] font-semibold", tone)}>{title}</p>
                                    <p className="text-[12.5px] font-medium">
                                        {alert.kind === "account"
                                            ? `${alert.unknownCount} kamera tidak diketahui statusnya`
                                            : `${alert.cameraLabel} · ${alert.area} — ${alert.storeName}`}
                                    </p>
                                    <p className="text-xs font-medium text-subtle">{alert.contractorName}</p>
                                </div>
                                {alert.contractorPhone ? (
                                    <a
                                        href={`tel:${alert.contractorPhone.replace(/[^\d+]/g, "")}`}
                                        className="flex shrink-0 items-center gap-[5px] text-[12.5px] font-semibold text-primary hover:underline"
                                    >
                                        <Phone className="size-[13px]" />
                                        Hubungi
                                    </a>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="border-t pt-3.5 text-[11.5px] font-medium text-subtle">
                Status perangkat dicek otomatis tiap 5 menit melalui EZVIZ Open API. Riwayat koneksi dicatat oleh server Sparta.
            </p>
        </aside>
    );
}
