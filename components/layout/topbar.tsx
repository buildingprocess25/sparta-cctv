import { Bell } from "lucide-react";
import { SearchBox } from "@/components/dashboard/search-box";
import { formatTime } from "@/lib/format";

export function Topbar({
    lastCheckedAt,
    hasAlerts,
}: {
    lastCheckedAt: Date;
    hasAlerts: boolean;
}) {
    return (
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-white/85 px-4 py-3 backdrop-blur-sm lg:px-7">
            <SearchBox />
            <div className="flex items-center gap-4">
                <p className="hidden text-[12.5px] font-medium text-subtle md:block">
                    Status dicek tiap 5 menit · terakhir {formatTime(lastCheckedAt)}
                </p>
                <button
                    type="button"
                    aria-label="Notifikasi"
                    className="relative flex size-9 items-center justify-center rounded-lg border bg-white text-muted-foreground hover:bg-muted"
                >
                    <Bell className="size-[18px]" />
                    {hasAlerts ? (
                        <span className="absolute top-[7px] right-[9px] size-2 rounded-full border-2 border-white bg-alert-badge" />
                    ) : null}
                </button>
            </div>
        </header>
    );
}
