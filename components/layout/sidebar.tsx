"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    HardHat,
    LayoutGrid,
    LogOut,
    SlidersHorizontal,
    Store,
    TriangleAlert,
    Video,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    badge?: number;
};

export function Sidebar({ alertCount }: { alertCount: number }) {
    const pathname = usePathname();

    const nav: NavItem[] = [
        { href: "/", label: "Dashboard", icon: LayoutGrid },
        { href: "/kamera", label: "Semua Kamera", icon: Video },
        { href: "/perlu-ditindak", label: "Perlu Ditindak", icon: TriangleAlert, badge: alertCount },
        { href: "/toko", label: "Toko", icon: Store },
        { href: "/kontraktor", label: "Kontraktor", icon: HardHat },
    ];

    return (
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col justify-between bg-sidebar px-3 pt-5 pb-4 lg:flex">
            <div className="flex flex-col gap-5">
                <div className="flex items-center gap-2.5 px-2 pb-1">
                    <Image src="/images/logo-alfamart.png" alt="Alfamart" width={60} height={34} className="h-[34px] w-[60px] object-contain" />
                    <span className="h-7 w-px bg-white/[0.22]" />
                    <Image src="/images/logo-sparta.png" alt="Sparta" width={26} height={33} className="h-[33px] w-[26px] object-contain" />
                    <div className="flex flex-col leading-tight">
                        <span className="text-sm font-bold tracking-[0.04em] text-white">SPARTA</span>
                        <span className="text-[11px] font-medium text-sidebar-muted">CCTV</span>
                    </div>
                </div>

                <nav className="flex flex-col gap-0.5">
                    {nav.map((item) => (
                        <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
                    ))}
                </nav>
            </div>

            <div className="flex flex-col gap-2">
                <NavLink
                    item={{ href: "/pengaturan", label: "Pengaturan", icon: SlidersHorizontal }}
                    active={isActive(pathname, "/pengaturan")}
                />
                <div className="h-px bg-sidebar-border" />
                <div className="flex items-center gap-2.5 px-2 pt-1.5">
                    <div className="flex size-[34px] items-center justify-center rounded-full bg-sidebar-avatar text-xs font-semibold text-white">
                        AD
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-[13px] font-semibold text-white">Admin</span>
                        <span className="truncate text-[11px] font-medium text-sidebar-muted">Building &amp; Maintenance</span>
                    </div>
                    <LogOut className="size-[17px] text-sidebar-muted" aria-label="Keluar" />
                </div>
            </div>
        </aside>
    );
}

function isActive(pathname: string, href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
    const Icon = item.icon;
    return (
        <Link
            href={item.href}
            className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-[9px] text-[13.5px] transition-colors",
                active
                    ? "bg-sidebar-active font-semibold text-white"
                    : "font-medium text-sidebar-foreground hover:bg-white/[0.06]",
            )}
        >
            <Icon className="size-[18px]" />
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
                <span className="rounded-full bg-alert-badge px-[7px] py-px text-[11px] font-bold text-white">
                    {item.badge}
                </span>
            ) : null}
        </Link>
    );
}
