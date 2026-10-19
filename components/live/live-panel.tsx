"use client";

import Hls from "hls.js";
import { Camera, Maximize, Pause, Play, Video, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EzopenPlayer, type EzopenAccess } from "./ezopen-player";
import { takeSnapshot } from "./snapshot-button";

const AUTO_STOP_SECONDS = 180;
const HEARTBEAT_MIN_MS = 60_000;

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

export function LivePanel({ cameraId, blockedMessage }: { cameraId: string; blockedMessage: string | null }) {
    const [tab, setTab] = useState<"live" | "playback">("live");

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
                ) : (
                    <PlaybackPlaceholder />
                )}
            </div>

            <p className="px-4 pt-4 text-xs font-medium text-subtle max-lg:order-3 lg:px-0 lg:pt-0">
                <span className="hidden lg:inline">
                    Untuk menghemat kuota 4G kamera, live stream berhenti otomatis setelah 3 menit tanpa interaksi.
                </span>
                <span className="lg:hidden">
                    Live berhenti otomatis setelah 3 menit tanpa interaksi untuk menghemat kuota 4G.
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
                Pilih tanggal dan rentang jam pada Rekaman MicroSD
            </p>
        </div>
    );
}

type StreamState = "idle" | "loading" | "playing" | "error";

function LivePlayer({ cameraId, blockedMessage }: { cameraId: string; blockedMessage: string | null }) {
    const offline = blockedMessage !== null;
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);

    const [streamState, setStreamState] = useState<StreamState>(offline ? "idle" : "loading");
    const [streamError, setStreamError] = useState<string | null>(null);
    const [remaining, setRemaining] = useState(AUTO_STOP_SECONDS);
    const [watched, setWatched] = useState(0);
    const [clock, setClock] = useState<string | null>(null);
    const [ezopen, setEzopen] = useState<EzopenAccess | null>(null);
    const playing = streamState === "playing";

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

    // Cleanup HLS saat unmount
    useEffect(() => {
        return () => {
            destroyHls();
        };
    }, []);

    function destroyHls() {
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
    }

    async function startStream() {
        if (offline) return;
        setStreamState("loading");
        setStreamError(null);
        setWatched(0);
        setRemaining(AUTO_STOP_SECONDS);

        try {
            const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/live`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            const body = (await res.json()) as
                | ({ kind: "ezopen"; expiresAt: string } & EzopenAccess)
                | { kind: "hls"; url: string; expiresAt: string };
            if (body.kind === "ezopen") {
                // Status "playing" diset oleh EzopenPlayer saat frame pertama tampil.
                setEzopen({ url: body.url, accessToken: body.accessToken, domain: body.domain });
            } else {
                attachHls(body.url);
            }
        } catch (error) {
            setEzopen(null);
            const msg = error instanceof Error ? error.message : "Gagal memulai stream";
            setStreamError(msg);
            setStreamState("error");
            toast.error(`Live stream gagal: ${msg}`);
        }
    }

    function attachHls(url: string) {
        const video = videoRef.current;
        if (!video) return;

        destroyHls();

        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 30,
            });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(() => {});
                setStreamState("playing");
            });
            hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (data.fatal) {
                    console.error("[hls] fatal error:", {
                        type: data.type,
                        details: data.details,
                        url: (data as unknown as Record<string, unknown>).url,
                        response: (data as unknown as Record<string, unknown>).response,
                    });
                    setStreamError(`Stream gagal: ${data.details ?? data.type ?? "unknown"}`);
                    setStreamState("error");
                    destroyHls();
                }
            });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Safari — native HLS
            video.src = url;
            video.addEventListener("loadedmetadata", () => {
                video.play().catch(() => {});
                setStreamState("playing");
            }, { once: true });
        } else {
            setStreamError("Browser tidak mendukung HLS");
            setStreamState("error");
        }
    }

    function stopStream() {
        destroyHls();
        setEzopen(null);
        const video = videoRef.current;
        if (video) {
            video.pause();
            video.removeAttribute("src");
            video.load();
        }
        // Beritahu server agar sesi ditutup (fire-and-forget)
        fetch(`/api/cameras/${encodeURIComponent(cameraId)}/live`, { method: "DELETE" }).catch(() => {});
        setStreamState("idle");
        setStreamError(null);
    }

    const lastBeat = useRef(0);
    const touch = useCallback(() => {
        if (!playing) return;
        setRemaining(AUTO_STOP_SECONDS);
        // Heartbeat ke server (maks. 1x per 60 dtk) agar alamat stream diperpanjang.
        const now = Date.now();
        if (now - lastBeat.current < HEARTBEAT_MIN_MS) return;
        lastBeat.current = now;
        fetch(`/api/cameras/${encodeURIComponent(cameraId)}/live`, { method: "PATCH" }).catch(() => {});
    }, [playing, cameraId]);

    // Auto-mulai saat komponen mount (kalau kamera online)
    useEffect(() => {
        if (!offline) {
            const t = setTimeout(startStream, 0);
            return () => clearTimeout(t);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            ref={containerRef}
            onPointerMove={touch}
            onClick={touch}
            className="relative h-[219px] overflow-hidden bg-[#1b1f26] lg:h-[430px] lg:rounded-xl"
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
                    onPlaying={() => setStreamState("playing")}
                    onError={(msg) => {
                        setEzopen(null);
                        setStreamError(msg);
                        setStreamState("error");
                    }}
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
                            <p className="text-[11px] font-medium text-white/50">Menghubungkan ke kamera…</p>
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
                            Lanjutkan live
                        </button>
                    )}
                </div>
            )}

            {/* Badge LIVE */}
            {playing && (
                <span className="absolute top-2.5 left-2.5 rounded-sm bg-alert-badge px-[7px] py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-white lg:top-3 lg:left-3 lg:px-2 lg:py-[3px] lg:text-[11px]">
                    LIVE
                </span>
            )}

            {/* Timestamp */}
            {clock && (
                <span className="absolute top-3 left-[60px] hidden rounded-sm bg-[#0b0d11]/55 px-1.5 py-[3px] font-mono text-[11px] font-medium text-white backdrop-blur-[4px] lg:block">
                    {clock}
                </span>
            )}

            {/* Auto-stop countdown */}
            {playing && (
                <span className="absolute top-2.5 right-2.5 flex items-center gap-1.5 rounded-md bg-[#0b0d11]/55 px-2 py-[3px] text-[11px] font-medium whitespace-nowrap text-white/80 backdrop-blur-[6px] lg:top-3 lg:right-3 lg:px-2.5 lg:py-[5px] lg:text-xs">
                    <span className="lg:hidden">Berhenti dalam</span>
                    <span className="hidden lg:inline">Berhenti otomatis dalam</span>
                    <span className="font-mono text-white">{mmss(remaining)}</span>
                </span>
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
                    <span className="font-mono text-[11px] font-medium text-white/85 lg:hidden">{clock}</span>
                    <span className="hidden text-[12.5px] font-medium text-white/85 lg:inline">
                        Ditonton {mmss(watched)}
                    </span>
                </div>
                <div className="flex items-center gap-3.5 lg:gap-1">
                    <button
                        aria-label="Ambil snapshot"
                        onClick={(e) => { e.stopPropagation(); void takeSnapshot(cameraId); }}
                        className="flex items-center justify-center text-white lg:size-8"
                    >
                        <Camera className="size-[17px] lg:size-4" />
                    </button>
                    <button
                        aria-label="Layar penuh"
                        onClick={(e) => { e.stopPropagation(); containerRef.current?.requestFullscreen?.(); }}
                        className="flex items-center justify-center text-white lg:size-8"
                    >
                        <Maximize className="size-[17px] lg:size-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
