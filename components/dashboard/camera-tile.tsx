import Link from "next/link";
import { CircleHelp, ImageIcon, Play, WifiOff } from "lucide-react";
import { formatDuration, formatOsd, formatPercent } from "@/lib/format";
import type { CameraStatus, CameraView, SdStatus } from "@/lib/monitoring";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<CameraStatus, { label: string; text: string; dot: string }> = {
    ONLINE: { label: "Online", text: "text-status-online", dot: "bg-status-online-dot" },
    UNSTABLE: { label: "Tidak stabil", text: "text-status-warning", dot: "bg-status-warning-dot" },
    OFFLINE: { label: "Offline", text: "text-status-offline", dot: "bg-status-offline" },
    UNKNOWN: { label: "Tidak diketahui", text: "text-muted-foreground", dot: "bg-subtle" },
};

export const SD_LABEL: Record<SdStatus, string> = {
    OK: "MicroSD normal",
    NOT_FORMATTED: "MicroSD belum diformat",
    UNREADABLE: "MicroSD tidak terbaca",
    NONE: "Tanpa MicroSD",
};

function subtitle(camera: CameraView, now: Date) {
    if (camera.status === "UNKNOWN") return "Status belum diketahui · menunggu pengecekan";
    const sd = SD_LABEL[camera.sdStatus];
    if (camera.status === "OFFLINE" && camera.statusSince) {
        return `Offline ${formatDuration(camera.statusSince, now)} · ${sd}`;
    }
    if (camera.status === "UNSTABLE") {
        return `Putus ${camera.disconnectsToday}× hari ini · ${sd}`;
    }
    const uptime = camera.uptime7d != null ? ` · Uptime 7 hari ${formatPercent(camera.uptime7d)}` : "";
    return `${sd}${uptime}`;
}

export function CameraTile({ camera, now }: { camera: CameraView; now: Date }) {
    const status = STATUS_META[camera.status];
    const offline = camera.status === "OFFLINE";
    const unknown = camera.status === "UNKNOWN";

    return (
        <div className="flex min-w-0 flex-col gap-2.5">
            <div
                className={cn(
                    "relative aspect-[16/9] overflow-hidden rounded-lg",
                    offline || unknown ? "bg-video-offline" : "bg-video",
                )}
            >
                {offline ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-video-offline/55">
                        <WifiOff className="size-[22px] text-white" />
                        <p className="text-[13px] font-semibold text-white">Kamera offline</p>
                        <p className="text-[11px] font-medium text-white/70">Menampilkan snapshot terakhir</p>
                    </div>
                ) : unknown ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-video-offline/55">
                        <CircleHelp className="size-[22px] text-white" />
                        <p className="text-[13px] font-semibold text-white">Status belum diketahui</p>
                        <p className="text-[11px] font-medium text-white/70">Menunggu pengecekan perangkat</p>
                    </div>
                ) : camera.snapshotUrl ? (
                    // Snapshot dinamis dari route internal; next/image tidak diperlukan.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={camera.snapshotUrl}
                        alt={`Snapshot ${camera.label} ${camera.area}`}
                        loading="lazy"
                        className="absolute inset-0 size-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                        <ImageIcon className="size-[22px] text-white/40" />
                        <p className="text-[11px] font-medium text-white/40">Snapshot kamera</p>
                    </div>
                )}
                {!unknown && (
                    <span className="absolute top-2 left-2 rounded-sm bg-[#0b0d11]/55 px-1.5 py-[3px] font-mono text-[11px] font-medium text-white backdrop-blur-[4px]">
                        {formatOsd(camera.lastSnapshotAt)}
                    </span>
                )}
                {!offline && !unknown && (
                    <Link
                        href={`/kamera/${encodeURIComponent(camera.id)}`}
                        className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-md border border-white/[0.28] bg-white/[0.16] py-1.5 pr-3 pl-2.5 text-xs font-semibold text-white backdrop-blur-[6px] hover:bg-white/25"
                    >
                        <Play className="size-3 fill-white" />
                        Putar live
                    </Link>
                )}
            </div>
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">
                    {camera.label} · {camera.area}
                </p>
                <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-semibold", status.text)}>
                    <span className={cn("size-[7px] rounded-full", status.dot)} />
                    {status.label}
                </span>
            </div>
            <p className="text-xs font-medium text-muted-foreground">{subtitle(camera, now)}</p>
        </div>
    );
}
