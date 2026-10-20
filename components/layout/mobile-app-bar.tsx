import { Bell } from "lucide-react";
import Image from "next/image";

export function MobileAppBar({ hasAlerts }: { hasAlerts: boolean }) {
    return (
        <header className="flex items-center justify-between bg-sidebar px-4 py-3 lg:hidden">
            <div className="flex items-center gap-[9px]">
                <Image src="/images/logo-alfamart.png" alt="Alfamart" width={50} height={28} className="h-7 w-[50px] object-contain" />
                <span className="h-[22px] w-px bg-white/[0.22]" />
                <Image src="/images/logo-sparta.png" alt="Sparta" width={22} height={28} className="h-7 w-[22px] object-contain" />
                <div className="flex flex-col leading-tight">
                    <span className="text-[12.5px] font-bold tracking-[0.04em] text-white">SPARTA</span>
                    <span className="text-[10px] font-medium text-sidebar-muted">CCTV</span>
                </div>
            </div>
            <button
                type="button"
                aria-label="Notifikasi"
                className="relative flex size-9 items-center justify-center rounded-lg text-white"
            >
                <Bell className="size-5" />
                {hasAlerts ? (
                    <span className="absolute top-[7px] right-[9px] size-2 rounded-full border-2 border-sidebar bg-alert-badge" />
                ) : null}
            </button>
        </header>
    );
}
