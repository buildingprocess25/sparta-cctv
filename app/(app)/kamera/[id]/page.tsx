import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATUS_META } from "@/components/dashboard/camera-tile";
import { ConnectionSection, DeviceSection, SdSection, StoreSection } from "@/components/live/info-sections";
import { LivePanel } from "@/components/live/live-panel";
import { PlaybackCard } from "@/components/live/playback-card";
import { SnapshotButton } from "@/components/live/snapshot-button";
import { formatDateChip, formatDayMonth } from "@/lib/format";
import type { GatewayErrorKind } from "@/lib/cameras/errors";
import { getCameraDetail } from "@/lib/monitoring";
import { cn } from "@/lib/utils";

const RECORDINGS_NOTE: Record<GatewayErrorKind, string> = {
    account_unavailable: "Rekaman tidak dapat dimuat: akun EZVIZ kontraktor bermasalah.",
    offline: "Rekaman tidak dapat dimuat: kamera offline.",
    not_found: "Rekaman belum tersedia: serial perangkat belum terdaftar.",
    unsupported: "Perangkat ini tidak mendukung daftar rekaman.",
    rate_limited: "Batas panggilan EZVIZ tercapai. Coba lagi beberapa saat.",
    transient: "Rekaman gagal dimuat. Coba muat ulang halaman.",
};

const BLOCKED_MESSAGE = {
    OFFLINE: (label: string) => `Kamera offline · ${label}`,
    UNKNOWN: () => "Status kamera belum diketahui",
} as const;

export default async function LiveViewPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const detail = await getCameraDetail(decodeURIComponent(id));
    if (!detail) notFound();

    const { camera, store } = detail;
    const status = STATUS_META[camera.status];
    const title = `${camera.label} · ${camera.area}`;
    const now = new Date();
    const shortDate = formatDayMonth(now);
    const dateLabel = formatDateChip(now);

    return (
        <div className="flex flex-col lg:gap-5 lg:px-7 lg:pt-5 lg:pb-8">
            {/* Header mobile */}
            <header className="flex items-center gap-1.5 bg-white py-2 pr-4 pl-2 lg:hidden">
                <Link href="/" aria-label="Kembali" className="flex size-10 items-center justify-center">
                    <ChevronLeft className="size-[22px]" />
                </Link>
                <div className="min-w-0">
                    <p className="flex items-center gap-2 text-base font-semibold">
                        <span className="truncate">{title}</span>
                        <span className={cn("size-[7px] shrink-0 rounded-full", status.dot)} />
                    </p>
                    <p className="truncate text-xs font-medium text-muted-foreground">{store.name}</p>
                </div>
            </header>

            {/* Header desktop */}
            <header className="hidden items-end justify-between lg:flex">
                <div className="flex flex-col gap-1.5">
                    <nav className="flex items-center gap-1.5 text-[13px] font-medium" aria-label="Breadcrumb">
                        <Link href="/" className="text-primary hover:underline">
                            Dashboard
                        </Link>
                        <ChevronRight className="size-[13px] text-subtle" />
                        <span className="text-muted-foreground">{store.name}</span>
                    </nav>
                    <h1 className="flex items-center gap-3 text-2xl font-bold">
                        {title}
                        <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold", status.text)}>
                            <span className={cn("size-2 rounded-full", status.dot)} />
                            {status.label}
                        </span>
                    </h1>
                </div>
                <SnapshotButton cameraId={camera.id} />
            </header>

            <div className="flex flex-col gap-4 pb-8 lg:grid lg:grid-cols-[minmax(0,1fr)_352px] lg:items-start lg:gap-5 lg:pb-0">
                <div className="contents lg:flex lg:flex-col lg:gap-3">
                    <LivePanel
                        cameraId={camera.id}
                        blockedMessage={
                            camera.status === "OFFLINE"
                                ? BLOCKED_MESSAGE.OFFLINE(camera.label)
                                : camera.status === "UNKNOWN"
                                  ? BLOCKED_MESSAGE.UNKNOWN()
                                  : null
                        }
                    />
                    <div className="px-4 max-lg:order-4 lg:px-0">
                        <PlaybackCard
                            recordings={detail.recordings}
                            nowMinutes={detail.nowMinutes}
                            dateLabel={dateLabel}
                            shortDateLabel={shortDate}
                            note={detail.recordingsError ? RECORDINGS_NOTE[detail.recordingsError] : null}
                        />
                    </div>
                </div>
                <aside className="flex flex-col gap-4 px-4 max-lg:contents lg:rounded-xl lg:border lg:bg-card lg:px-5 lg:py-1">
                    <ConnectionSection detail={detail} className="max-lg:order-2 max-lg:mx-4" />
                    <SdSection detail={detail} />
                    <DeviceSection detail={detail} className="max-lg:order-3 max-lg:mx-4" />
                    <StoreSection detail={detail} className="max-lg:order-5 max-lg:mx-4" />
                </aside>
            </div>
        </div>
    );
}
