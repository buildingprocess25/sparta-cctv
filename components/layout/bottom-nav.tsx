"use client";

import { LayoutGrid, TriangleAlert, User, Video, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; icon: LucideIcon; alerts?: boolean }[] = [
    { href: "/", label: "Beranda", icon: LayoutGrid },
    { href: "/kamera", label: "Kamera", icon: Video },
    { href: "/perlu-ditindak", label: "Ditindak", icon: TriangleAlert, alerts: true },
    { href: "/pengaturan", label: "Akun", icon: User },
];

export function BottomNav({ alertCount }: { alertCount: number }) {
    const pathname = usePathname();
    // Live View memakai layar penuh di mobile.
    if (pathname.startsWith("/kamera/")) return null;

    return (
        <nav
            aria-label="Navigasi utama"
            className="fixed inset-x-0 bottom-0 z-20 flex items-start justify-between border-t bg-white/[0.86] px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-[10px] lg:hidden"
        >
            {TABS.map(({ href, label, icon: Icon, alerts }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                    <Link
                        key={href}
                        href={href}
                        className={cn(
                            "flex flex-col items-center gap-1 px-3 pt-1 text-[11px]",
                            active ? "font-semibold text-primary" : "font-medium text-subtle",
                        )}
                    >
                        <span className="relative">
                            <Icon className="size-[22px]" />
                            {alerts && alertCount > 0 ? (
                                <span className="absolute -top-1 left-3.5 rounded-full bg-alert-badge px-[5px] text-[10px] font-bold text-white">
                                    {alertCount}
                                </span>
                            ) : null}
                        </span>
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
