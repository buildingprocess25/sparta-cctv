"use client";

import {
    Camera,
    Circle,
    Maximize,
    Mic,
    Move,
    Pause,
    Play,
    Square,
    Video,
    Volume2,
    VolumeX,
    WifiOff,
    ZoomIn,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EzopenPlayer, type TalkChange } from "./ezopen-player";
import { usePlayback, type PlaybackRange } from "./playback-context";
import { PtzPad } from "./ptz-pad";
import { takeSnapshot } from "./snapshot-button";
import { useLiveSession } from "./use-live-session";

const AUTO_STOP_SECONDS = 180;

const pad = (n: number) => String(n).padStart(2, "0");
const mmss = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

function formatClock(date: Date) {
    const parts = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** "19/10 15:00–16:00" */
function formatRange({ start, end }: PlaybackRange) {
    const [day, from] = formatClock(start).split(" ");
    return `${day} ${from.slice(0, 5)}–${formatClock(end).split(" ")[1].slice(0, 5)}`;
}

export function LivePanel({ cameraId, blockedMessage }: { cameraId: string; blockedMessage: string | null }) {
    const { tab, setTab, range } = usePlayback();

    return (
        <div className="flex flex-col lg:gap-3">
            <div role="tablist" className="flex gap-6 border-b px-4 max-lg:order-2 max-lg:pt-1 lg:px-0">
                {(["live", "playback"] as const).map((key) => (
                    <button
                        key={key}
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => setTab(key)}
                        className={cn(
                            "-mb-px border-b-2 pt-3 pb-2.5 text-sm lg:pt-1",
                            tab === key
                                ? "border-primary font-semibold text-foreground"
                                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {key === "live" ? "Live" : "Playback"}
                    </button>
                ))}
            </div>

            <div className="max-lg:order-1 lg:contents">
                {tab === "live" ? (
                    <LivePlayer cameraId={cameraId} blockedMessage={blockedMessage} />
                ) : range ? (
                    // key: rentang baru → player dipasang ulang dengan alamat .rec baru
                    <LivePlayer
                        key={`${range.start.getTime()}-${range.end.getTime()}`}
                        cameraId={cameraId}
                        blockedMessage={blockedMessage}
                        playback={range}
                    />
                ) : (
                    <PlaybackPlaceholder />
                )}
            </div>

            <p className="px-4 pt-4 text-xs font-medium text-subtle max-lg:order-3 lg:px-0 lg:pt-0">
                <span className="hidden lg:inline">
                    Untuk menghemat kuota 4G kamera, live dan playback berhenti otomatis setelah 3 menit tanpa interaksi.
                </span>
                <span className="lg:hidden">
                    Live dan playback berhenti otomatis setelah 3 menit tanpa interaksi untuk menghemat kuota 4G.
                </span>
            </p>
        </div>
    );
}

function PlaybackPlaceholder() {
    return (
        <div className="flex h-[219px] flex-col items-center justify-center gap-2 bg-[#1b1f26] lg:h-[430px] lg:rounded-xl">
            <Video className="size-7 text-white/40" />
            <p className="text-xs font-medium text-white/40">
                Pilih tanggal dan jam pada Rekaman MicroSD, lalu klik Putar rekaman
            </p>
        </div>
    );
}

type TalkState = "off" | "connecting" | "on";

function ControlButton({
    label,
    icon: Icon,
    active = false,
    tone = "default",
    onClick,
    children,
}: {
    label: string;
    icon?: LucideIcon;
    active?: boolean;
    /** "alert": merah saat aktif (mic/rekam), agar jelas sedang berjalan */
    tone?: "default" | "alert";
    onClick: () => void;
    children?: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={cn(
                "flex h-6 min-w-6 items-center justify-center rounded-md text-white transition-colors @xl:h-8 @xl:min-w-8",
                active ? (tone === "alert" ? "bg-alert-badge" : "bg-white/25") : "hover:bg-white/14",
            )}
        >
            {Icon ? (
                <Icon className={cn("size-[17px] lg:size-4", active && tone === "alert" && "animate-pulse")} />
            ) : (
                children
            )}
        </button>
    );
}

const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");

function LivePlayer({
    cameraId,
    blockedMessage,
    playback,
}: {
    cameraId: string;
    blockedMessage: string | null;
    /** bila diisi → putar rekaman MicroSD rentang ini (tanpa mic, PTZ, HD, snapshot) */
    playback?: PlaybackRange;
}) {
    const offline = blockedMessage !== null;
    const isLive = !playback;
    const containerRef = useRef<HTMLDivElement>(null);
    const session = useLiveSession({
        cameraId,
        playback,
        // Auto-mulai saat komponen mount (kalau kamera online)
        autoStart: !offline,
        onStartError: (msg) => toast.error(`${playback ? "Playback" : "Live stream"} gagal: ${msg}`),
    });
    const { state: streamState, error: streamError, ezopen, playing, videoRef } = session;

    const [remaining, setRemaining] = useState(AUTO_STOP_SECONDS);
    const [watched, setWatched] = useState(0);
    const [clock, setClock] = useState<string | null>(null);

    // Kontrol live: suara/mic/zoom/rekam lewat player ezopen; PTZ lewat server (juga untuk HLS).
    const controls = session.controlsRef;
    const [hd, setHd] = useState(false);
    const [sound, setSound] = useState(false);
    const [talk, setTalk] = useState<TalkState>("off");
    const [zoom, setZoom] = useState(false);
    const [recording, setRecording] = useState(false);
    const [ptzOpen, setPtzOpen] = useState(false);
    const ezopenControls = playing && ezopen !== null;
    // stopStream juga dipanggil dari interval auto-stop (closure lama), jadi baca status terbaru lewat ref.
    const liveFlags = useRef({ recording, talk });
    useEffect(() => {
        liveFlags.current = { recording, talk };
    });

    function resetControls() {
        setSound(false);
        setTalk("off");
        setZoom(false);
        setRecording(false);
    }

    // Jam real-time
    useEffect(() => {
        const tick = () => setClock(formatClock(new Date()));
        const first = setTimeout(tick, 0);
        const id = setInterval(tick, 1000);
        return () => {
            clearTimeout(first);
            clearInterval(id);
        };
    }, []);

    // Hitung mundur & stopwatch
    useEffect(() => {
        if (!playing) return;
        const id = setInterval(() => {
            setWatched((w) => w + 1);
            setRemaining((r) => {
                if (r <= 1) {
                    stopStream();
                    return 0;
                }
                return r - 1;
            });
        }, 1000);
        return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing]);

    async function startStream(highQuality = hd) {
        if (offline) return;
        setWatched(0);
        setRemaining(AUTO_STOP_SECONDS);
        resetControls();
        return session.start(highQuality);
    }

    function stopStream() {
        // Simpan klip yang sedang direkam dan matikan mic sebelum player dibongkar.
        if (liveFlags.current.recording) void controls.current?.stopRecording().catch(() => {});
        if (liveFlags.current.talk !== "off") controls.current?.stopTalk();
        resetControls();
        setPtzOpen(false);
        session.stop();
    }

    const { beat } = session;
    function touch() {
        if (!playing) return;
        setRemaining(AUTO_STOP_SECONDS);
        beat();
    }

    async function toggleSound() {
        const next = !sound;
        try {
            await controls.current?.setSound(next);
            setSound(next);
        } catch {
            toast.error("Gagal mengubah suara");
        }
    }

    function toggleTalk() {
        if (talk !== "off") {
            controls.current?.stopTalk();
            setTalk("off");
            return;
        }
        if (!window.isSecureContext) {
            toast.error("Bicara lewat mikrofon butuh koneksi HTTPS");
            return;
        }
        setTalk("connecting");
        controls.current?.startTalk();
    }

    function onTalkChange(change: TalkChange) {
        if (change.state === "on") {
            setTalk("on");
            toast.success("Mikrofon aktif, suara Anda terdengar di kamera");
        } else if (change.state === "off") {
            setTalk("off");
        } else {
            setTalk("off");
            toast.error(`Bicara gagal: ${change.message}`);
        }
    }

    async function toggleZoom() {
        const next = !zoom;
        try {
            await controls.current?.setZoom(next);
            setZoom(next);
            if (next) toast.info("Zoom digital aktif: gulir atau cubit pada video untuk memperbesar");
        } catch {
            toast.error("Gagal mengubah zoom");
        }
    }

    async function toggleRecording() {
        try {
            if (recording) {
                await controls.current?.stopRecording();
                setRecording(false);
                toast.success("Klip disimpan ke folder unduhan");
            } else {
                await controls.current?.startRecording(`kamera-${cameraId}-${fileStamp()}`);
                setRecording(true);
            }
        } catch {
            setRecording(false);
            toast.error("Gagal merekam klip");
        }
    }

    // Ganti kualitas = minta alamat .hd.live / .live baru, player dipasang ulang.
    // HD ditolak bila kamera lain di akun ini sedang live (pembatas bandwidth) → kembali ke SD.
    async function toggleHd() {
        const next = !hd;
        setHd(next);
        const result = await startStream(next);
        if (next && result?.code === "hd_busy") {
            setHd(false);
            await startStream(false);
        }
    }

    return (
        <div
            ref={containerRef}
            onPointerMove={touch}
            onClick={touch}
            className="@container relative h-[219px] overflow-hidden bg-[#1b1f26] lg:h-[430px] lg:rounded-xl"
        >
            {/* Video element — selalu ada di DOM agar HLS bisa attach */}
            <video
                ref={videoRef}
                className={cn(
                    "absolute inset-0 h-full w-full object-contain",
                    playing ? "opacity-100" : "opacity-0",
                )}
                playsInline
                muted
                autoPlay
            />

            {ezopen && (
                <EzopenPlayer
                    access={ezopen}
                    controlsRef={controls}
                    onTalkChange={onTalkChange}
                    onPlaying={session.onEzopenPlaying}
                    onError={session.onEzopenError}
                />
            )}

            {/* Overlay saat tidak playing */}
            {!playing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
                    {offline ? (
                        <>
                            <WifiOff className="size-7" />
                            <p className="text-xs font-medium text-white/70">{blockedMessage}</p>
                        </>
                    ) : streamState === "loading" ? (
                        <>
                            <div className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                            <p className="text-[11px] font-medium text-white/50">
                                {playback ? "Memuat rekaman dari MicroSD…" : "Menghubungkan ke kamera…"}
                            </p>
                        </>
                    ) : streamState === "error" ? (
                        <>
                            <WifiOff className="size-6 text-white/50" />
                            <p className="text-[11px] font-medium text-white/60">{streamError ?? "Stream gagal"}</p>
                            <button
                                onClick={(e) => { e.stopPropagation(); startStream(); }}
                                className="mt-1 rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/25"
                            >
                                Coba lagi
                            </button>
                        </>
                    ) : (
                        /* idle — paused manually */
                        <button
                            onClick={(e) => { e.stopPropagation(); startStream(); }}
                            className="flex items-center gap-2 rounded-lg border border-white/25 bg-white/15 px-4 py-2 text-[13px] font-semibold text-white hover:bg-white/25"
                        >
                            <Play className="size-3.5 fill-white" />
                            {playback ? "Putar lagi" : "Lanjutkan live"}
                        </button>
                    )}
                </div>
            )}

            {/* Badge LIVE / REKAMAN */}
            {playing && (
                <span
                    className={cn(
                        "absolute top-2.5 left-2.5 rounded-sm px-[7px] py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-white lg:top-3 lg:left-3 lg:px-2 lg:py-[3px] lg:text-[11px]",
                        playback ? "bg-primary" : "bg-alert-badge",
                    )}
                >
                    {playback ? "REKAMAN" : "LIVE"}
                </span>
            )}

            {/* Timestamp (live) / rentang rekaman (playback) */}
            {playback ? (
                <span className="absolute top-2.5 left-[88px] hidden @min-[22rem]:block rounded-sm bg-[#0b0d11]/55 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-white backdrop-blur-[4px] lg:top-3 lg:left-[100px] lg:py-[3px] lg:text-[11px]">
                    {formatRange(playback)}
                </span>
            ) : clock && (
                <span className="absolute top-2.5 left-[52px] hidden @min-[22rem]:block rounded-sm bg-[#0b0d11]/55 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-white backdrop-blur-[4px] lg:top-3 lg:left-[60px] lg:py-[3px] lg:text-[11px]">
                    {clock}
                </span>
            )}

            {/* Auto-stop countdown */}
            {playing && (
                <span className="absolute top-2.5 right-2.5 flex items-center gap-1.5 rounded-md bg-[#0b0d11]/55 px-2 py-[3px] text-[11px] font-medium whitespace-nowrap text-white/80 backdrop-blur-[6px] lg:top-3 lg:right-3 lg:px-2.5 lg:py-[5px] lg:text-xs">
                    <span className="@xl:hidden">Berhenti dalam</span>
                    <span className="hidden @xl:inline">Berhenti otomatis dalam</span>
                    <span className="font-mono text-white">{mmss(remaining)}</span>
                </span>
            )}

            {/* D-pad PTZ */}
            {playing && ptzOpen && (
                <PtzPad
                    cameraId={cameraId}
                    onInteract={touch}
                    className="absolute top-1/2 right-2.5 -translate-y-[60%] lg:right-4"
                />
            )}

            {/* Control bar */}
            <div className="absolute right-2.5 bottom-2.5 left-2.5 flex h-10 items-center justify-between rounded-lg border border-white/12 bg-[#0b0d11]/50 px-2 backdrop-blur-[8px] lg:right-3 lg:bottom-3 lg:left-3 lg:h-12 lg:rounded-[10px] lg:px-2.5">
                <div className="flex items-center gap-2 lg:gap-2.5">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (playing) stopStream();
                            else startStream();
                        }}
                        disabled={offline || streamState === "loading"}
                        aria-label={playing ? "Jeda" : "Putar"}
                        className="flex size-6 items-center justify-center rounded-md text-white disabled:opacity-40 lg:size-8 lg:bg-white/14"
                    >
                        {playing ? <Pause className="size-4 lg:size-[15px]" /> : <Play className="size-4 fill-white lg:size-[15px]" />}
                    </button>
                    <span className="hidden text-[12.5px] font-medium text-white/85 @xl:inline">
                        Ditonton {mmss(watched)}
                    </span>
                </div>
                <div className="flex items-center gap-1.5 @xl:gap-1">
                    {ezopenControls && (
                        <>
                            <ControlButton
                                label={sound ? "Matikan suara" : "Nyalakan suara"}
                                icon={sound ? Volume2 : VolumeX}
                                active={sound}
                                onClick={toggleSound}
                            />
                            {isLive && (
                                <ControlButton
                                    label={talk === "off" ? "Bicara lewat mikrofon" : "Hentikan mikrofon"}
                                    icon={Mic}
                                    active={talk !== "off"}
                                    tone="alert"
                                    onClick={toggleTalk}
                                />
                            )}
                            <ControlButton label="Zoom digital" icon={ZoomIn} active={zoom} onClick={toggleZoom} />
                            <ControlButton
                                label={recording ? "Hentikan & simpan klip" : "Rekam klip"}
                                icon={recording ? Square : Circle}
                                active={recording}
                                tone="alert"
                                onClick={toggleRecording}
                            />
                            {isLive && (
                                <ControlButton
                                    label={hd ? "Kualitas HD (klik untuk hemat data)" : "Kualitas hemat data (klik untuk HD)"}
                                    active={hd}
                                    onClick={toggleHd}
                                >
                                    <span className="px-0.5 text-[10.5px] font-bold tracking-wide lg:text-[11px]">
                                        {hd ? "HD" : "SD"}
                                    </span>
                                </ControlButton>
                            )}
                        </>
                    )}
                    {playing && isLive && (
                        <ControlButton
                            label={ptzOpen ? "Tutup kontrol putar" : "Putar kamera (PTZ)"}
                            icon={Move}
                            active={ptzOpen}
                            onClick={() => setPtzOpen((v) => !v)}
                        />
                    )}
                    {isLive && (
                        <ControlButton label="Ambil snapshot" icon={Camera} onClick={() => void takeSnapshot(cameraId)} />
                    )}
                    <ControlButton
                        label="Layar penuh"
                        icon={Maximize}
                        onClick={() => containerRef.current?.requestFullscreen?.()}
                    />
                </div>
            </div>
        </div>
    );
}
