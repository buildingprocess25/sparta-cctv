import { Phone } from "lucide-react";
import { SD_LABEL } from "@/components/dashboard/camera-tile";
import { formatPercent, formatShortDate, formatTime } from "@/lib/format";
import type { CameraDetail, CameraStatus, ConnectivitySlot, SdStatus } from "@/lib/monitoring";
import { cn } from "@/lib/utils";

// Di mobile tiap seksi menjadi kartu sendiri; di desktop seksi dipisah garis di dalam satu kartu.
const section =
    "flex flex-col gap-3 rounded-xl border bg-card p-4 lg:rounded-none lg:border-0 lg:border-t lg:bg-transparent lg:px-0 lg:py-4 lg:first:border-t-0";

const STATUS_TEXT: Record<CameraStatus, { verb: string; tone: string; dot: string }> = {
    ONLINE: { verb: "Online", tone: "text-status-online", dot: "bg-status-online-dot" },
    UNSTABLE: { verb: "Tidak stabil", tone: "text-status-warning", dot: "bg-status-warning-dot" },
    OFFLINE: { verb: "Offline", tone: "text-status-offline", dot: "bg-status-offline" },
    UNKNOWN: { verb: "Status belum diketahui", tone: "text-muted-foreground", dot: "bg-subtle" },
};

const SLOT_CLASS: Record<ConnectivitySlot, string> = {
    up: "bg-status-online-dot/75",
    down: "bg-alert-badge",
    degraded: "bg-[#dc6803]",
};

function Row({
    label,
    children,
    mono,
}: {
    label: string;
    children: React.ReactNode;
    mono?: boolean;
}) {
    return (
        <div className="flex items-center justify-between gap-3 text-[13px]">
            <dt className="font-medium text-muted-foreground">{label}</dt>
            <dd className={cn("text-right", mono ? "font-mono font-medium" : "font-semibold")}>{children}</dd>
        </div>
    );
}

export function ConnectionSection({ detail, className }: { detail: CameraDetail; className?: string }) {
    const { camera, connectivity, lastCheckedAt } = detail;
    const status = STATUS_TEXT[camera.status];

    return (
        <section className={cn(section, className)}>
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Koneksi</h2>
                <p className={cn("flex items-center gap-1.5 text-[12.5px] font-medium lg:hidden", status.tone)}>
                    {status.verb}
                    {camera.statusSince ? ` sejak ${formatTime(camera.statusSince)}` : ""}
                </p>
            </div>
            <p className={cn("hidden items-center gap-1.5 text-[13px] font-medium lg:flex", status.tone)}>
                <span className={cn("size-2 rounded-full", status.dot)} />
                {status.verb}
                {camera.statusSince ? ` sejak ${formatTime(camera.statusSince)}` : ""}
            </p>
            <div className="flex flex-col gap-1.5">
                <div className="flex gap-0.5" role="img" aria-label="Konektivitas 24 jam terakhir">
                    {connectivity.map((slot, i) => (
                        <span key={i} className={cn("h-4 min-w-px flex-1 rounded-[2px] lg:h-[18px]", SLOT_CLASS[slot])} />
                    ))}
                </div>
                <div className="flex justify-between text-[11px] font-medium text-subtle">
                    <span>24 jam lalu</span>
                    <span>sekarang</span>
                </div>
            </div>
            <dl className="flex flex-col gap-3">
                <Row label="Uptime 7 hari">
                    {camera.status !== "UNKNOWN" && camera.uptime7d != null ? formatPercent(camera.uptime7d) : "–"}
                </Row>
                <Row label="Putus hari ini">{camera.status === "UNKNOWN" ? "–" : `${camera.disconnectsToday}×`}</Row>
                <div className="hidden lg:block">
                    <Row label="Terakhir dicek" mono>
                        {formatTime(lastCheckedAt)}
                    </Row>
                </div>
            </dl>
        </section>
    );
}

const SD_TONE: Record<SdStatus, string> = {
    OK: "text-status-online",
    NOT_FORMATTED: "text-status-warning",
    UNREADABLE: "text-status-offline",
    NONE: "text-muted-foreground",
};

function sdValue(status: SdStatus) {
    return status === "OK" ? "Normal" : SD_LABEL[status].replace("MicroSD ", "").replace(/^./, (c) => c.toUpperCase());
}

/** Status MicroSD tidak bisa dipercaya bila status kamera sendiri belum diketahui. */
function SdText({ camera }: { camera: CameraDetail["camera"] }) {
    if (camera.status === "UNKNOWN") return <span className="text-muted-foreground">Belum diketahui</span>;
    return <span className={SD_TONE[camera.sdStatus]}>{sdValue(camera.sdStatus)}</span>;
}

export function SdSection({ detail, className }: { detail: CameraDetail; className?: string }) {
    return (
        <section className={cn(section, "max-lg:hidden", className)}>
            <h2 className="text-sm font-semibold">MicroSD</h2>
            <dl className="flex flex-col gap-3">
                <Row label="Status">
                    <SdText camera={detail.camera} />
                </Row>
                <Row label="Rekaman">Lihat timeline</Row>
            </dl>
        </section>
    );
}

export function DeviceSection({ detail, className }: { detail: CameraDetail; className?: string }) {
    const { camera } = detail;
    return (
        <section className={cn(section, className)}>
            <h2 className="text-sm font-semibold">Perangkat</h2>
            <dl className="flex flex-col gap-3">
                <div className="lg:hidden">
                    <Row label="MicroSD">
                        <SdText camera={camera} />
                    </Row>
                </div>
                <Row label="Model">{camera.deviceModel ?? "–"}</Row>
                <Row label="Serial" mono>
                    {camera.deviceSerial ?? "–"}
                </Row>
            </dl>
        </section>
    );
}

export function StoreSection({ detail, className }: { detail: CameraDetail; className?: string }) {
    const { store } = detail;
    const tel = store.contractorPhone?.replace(/[^\d+]/g, "");

    return (
        <section className={cn(section, "gap-2.5 lg:gap-3", className)}>
            <h2 className="hidden text-sm font-semibold lg:block">Toko</h2>
            <p className="hidden text-[13.5px] font-semibold lg:block">{store.name}</p>
            <p className="text-sm font-semibold lg:hidden">{store.contractorName}</p>
            <p className="text-[12.5px] font-medium text-muted-foreground lg:hidden">
                {store.contractorPic ? `PIC ${store.contractorPic} · ` : ""}progres {store.progress}%
            </p>
            <dl className="hidden flex-col gap-3 lg:flex">
                <Row label="Kontraktor">{store.contractorName}</Row>
                <Row label="PIC">{store.contractorPic ?? "–"}</Row>
            </dl>
            <div className="hidden flex-col gap-1.5 lg:flex">
                <div className="flex justify-between text-[13px]">
                    <span className="font-medium text-muted-foreground">
                        Progres{store.targetDate ? ` · target ${formatShortDate(store.targetDate).replace(/ \d{4}$/, "")}` : ""}
                    </span>
                    <span className="font-semibold">{store.progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-track">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${store.progress}%` }} />
                </div>
            </div>
            {tel ? (
                <a
                    href={`tel:${tel}`}
                    className="flex items-center justify-center gap-2 rounded-lg border bg-white py-[9px] text-[13px] font-semibold hover:bg-muted"
                >
                    <Phone className="size-[15px] lg:size-4" />
                    Hubungi PIC
                </a>
            ) : null}
        </section>
    );
}
