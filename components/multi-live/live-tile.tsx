"use client";

import Link from "next/link";
import { CircleHelp, ExternalLink, ImageIcon, Maximize, Play, Volume2, VolumeX, WifiOff } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { STATUS_META } from "@/components/dashboard/camera-tile";
import { EzopenPlayer } from "@/components/live/ezopen-player";
import { useLiveSession } from "@/components/live/use-live-session";
import { formatOsd } from "@/lib/format";
import type { LiveGridCamera } from "@/lib/monitoring";
import { cn } from "@/lib/utils";
import { useMultiLive } from "./multi-live-context";

// Satu kamera di grid multi-live. Selalu sub-stream (quality 2), tanpa mic/PTZ/rekam/HD:
// kontrol lengkap ada di halaman detail kamera.

export function LiveTile({
    camera,
    live,
    startDelayMs,
    runId,
    canSwapIn,
    onSwapIn,
}: {
    camera: LiveGridCamera;
    /** kamera ini sedang mendapat slot live */
    live: boolean;
    /** jeda sebelum mulai, agar tile tidak meminta stream bersamaan */
    startDelayMs: number;
    /** berubah saat "Lanjutkan semua" → sesi dibuat ulang */
    runId: number;
    /** tombol "Live di sini" tampil (kamera bisa live dan grid tidak diblokir) */
    canSwapIn: boolean;
    onSwapIn: () => void;
}) {
    const frameRef = useRef<HTMLDivElement>(null);
    const status = STATUS_META[camera.status];

    return (
        <figure className="flex min-w-0 flex-col gap-2">
            <div
                ref={frameRef}
                className="@container relative aspect-video overflow-hidden rounded-xl bg-[#1b1f26] [&:fullscreen]:rounded-none"
            >
                {live ? (
                    <TileStream key={`${camera.id}-${runId}`} camera={camera} startDelayMs={startDelayMs} />
                ) : (
                    <TileSnapshot camera={camera} canSwapIn={canSwapIn} onSwapIn={onSwapIn} />
                )}

                <div className="absolute top-2 right-2 flex gap-1">
                    <TileButton
                        label="Layar penuh"
                        onClick={() => frameRef.current?.requestFullscreen?.()}
                    >
                        <Maximize className="size-4" />
                    </TileButton>
                    <Link
                        href={`/kamera/${encodeURIComponent(camera.id)}`}
                        aria-label="Buka detail kamera"
                        title="Buka detail kamera (PTZ, mikrofon, HD, playback)"
                        className="flex size-7 items-center justify-center rounded-md bg-[#0b0d11]/55 text-white backdrop-blur-[6px] hover:bg-[#0b0d11]/75"
                    >
                        <ExternalLink className="size-4" />
                    </Link>
                </div>
            </div>
            <figcaption className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                        {camera.label} · {camera.area}
                    </p>
                    <p className="truncate text-xs font-medium text-muted-foreground">
                        {camera.storeName} · <span className="font-mono">{camera.storeCode}</span>
                    </p>
                </div>
                <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-semibold", status.text)}>
                    <span className={cn("size-[7px] rounded-full", status.dot)} />
                    {status.label}
                </span>
            </figcaption>
        </figure>
    );
}

function TileButton({ label, active = false, onClick, children }: {
    label: string;
    active?: boolean;
    onClick: () => void;
    children: ReactNode;
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
                "flex size-7 items-center justify-center rounded-md text-white backdrop-blur-[6px]",
                active ? "bg-primary hover:bg-primary/90" : "bg-[#0b0d11]/55 hover:bg-[#0b0d11]/75",
            )}
        >
            {children}
        </button>
    );
}

function TileStream({ camera, startDelayMs }: { camera: LiveGridCamera; startDelayMs: number }) {
    const { registerBeat, soundCameraId, setSoundCameraId } = useMultiLive();
    const session = useLiveSession({ cameraId: camera.id, autoStart: true, autoStartDelayMs: startDelayMs });
    const { state, playing, ezopen, error, errorCode, videoRef, controlsRef, beat } = session;
    const sound = soundCameraId === camera.id;

    // Interaksi di mana pun pada grid memperpanjang sesi semua tile.
    useEffect(() => registerBeat(beat), [registerBeat, beat]);

    // Slot penuh tepat setelah tukar/lanjutkan biasanya karena DELETE sesi lama belum sampai di
    // server; coba sekali lagi sebelum menampilkan error.
    const retried = useRef(false);
    useEffect(() => {
        if (errorCode !== "full" || retried.current) return;
        retried.current = true;
        const t = setTimeout(() => void session.start(), 1500);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errorCode]);

    // Hanya satu tile bersuara; state-nya di grid.
    useEffect(() => {
        if (!playing || !ezopen) return;
        void controlsRef.current?.setSound(sound).catch(() => {});
    }, [sound, playing, ezopen, controlsRef]);

    return (
        <>
            <video
                ref={videoRef}
                className={cn("absolute inset-0 h-full w-full object-contain", playing ? "opacity-100" : "opacity-0")}
                playsInline
                muted={!sound}
                autoPlay
            />
            {ezopen && (
                <EzopenPlayer
                    access={ezopen}
                    controlsRef={controlsRef}
                    talk={false}
                    onPlaying={session.onEzopenPlaying}
                    onError={session.onEzopenError}
                />
            )}

            {!playing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                    {state === "error" ? (
                        <>
                            <WifiOff className="size-6 text-white/50" />
                            <p className="text-[11px] font-medium text-white/70">
                                {errorCode === "full" ? "Slot live akun penuh" : (error ?? "Stream gagal")}
                            </p>
                            {errorCode === "full" && (
                                <p className="text-[11px] font-medium text-white/50">
                                    Kamera lain di akun ini sedang dibuka di tempat lain.
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void session.start();
                                }}
                                className="mt-1 rounded-lg border border-white/25 bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/25"
                            >
                                Coba lagi
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="size-7 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                            <p className="text-[11px] font-medium text-white/50">Menghubungkan ke kamera…</p>
                        </>
                    )}
                </div>
            )}

            {playing && (
                <>
                    <span className="absolute top-2 left-2 rounded-sm bg-alert-badge px-[7px] py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-white">
                        LIVE
                    </span>
                    {ezopen && (
                        <div className="absolute bottom-2 left-2">
                            <TileButton
                                label={sound ? "Matikan suara" : "Nyalakan suara"}
                                active={sound}
                                onClick={() => setSoundCameraId(sound ? null : camera.id)}
                            >
                                {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                            </TileButton>
                        </div>
                    )}
                </>
            )}
        </>
    );
}

function TileSnapshot({
    camera,
    canSwapIn,
    onSwapIn,
}: {
    camera: LiveGridCamera;
    canSwapIn: boolean;
    onSwapIn: () => void;
}) {
    const offline = camera.status === "OFFLINE";
    const unknown = camera.status === "UNKNOWN";

    return (
        <>
            {camera.snapshotUrl ? (
                // Snapshot dinamis dari route internal; next/image tidak diperlukan.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={camera.snapshotUrl}
                    alt={`Snapshot ${camera.label} ${camera.area}`}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover"
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                    <ImageIcon className="size-[22px] text-white/30" />
                </div>
            )}
            {offline || unknown ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-video-offline/70">
                    {offline ? <WifiOff className="size-[22px] text-white" /> : <CircleHelp className="size-[22px] text-white" />}
                    <p className="text-[13px] font-semibold text-white">
                        {offline ? "Kamera offline" : "Status belum diketahui"}
                    </p>
                    <p className="text-[11px] font-medium text-white/70">
                        {offline ? "Menampilkan snapshot terakhir" : "Menunggu pengecekan perangkat"}
                    </p>
                </div>
            ) : (
                <span className="absolute top-2 left-2 rounded-sm bg-[#0b0d11]/55 px-1.5 py-[3px] font-mono text-[11px] font-medium text-white backdrop-blur-[4px]">
                    {formatOsd(camera.lastSnapshotAt)}
                </span>
            )}
            {canSwapIn && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSwapIn();
                    }}
                    className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-md border border-white/[0.28] bg-white/[0.16] py-1.5 pr-3 pl-2.5 text-xs font-semibold text-white backdrop-blur-[6px] hover:bg-white/25"
                >
                    <Play className="size-3 fill-white" />
                    Live di sini
                </button>
            )}
        </>
    );
}
