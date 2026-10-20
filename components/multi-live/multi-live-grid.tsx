"use client";

import { Maximize, Pause, Play, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canGoLive, pickLiveCameras, type LiveGridCamera } from "@/lib/monitoring-core";
import { cn } from "@/lib/utils";
import { LiveTile } from "./live-tile";
import { MultiLiveContext, type MultiLiveContextValue } from "./multi-live-context";

// Grid live semua kamera satu kontraktor. Paket Free EZVIZ = 1 Mbps per akun, jadi paling banyak
// `maxLive` kamera diputar bersamaan (sub-stream); sisanya tampil sebagai snapshot dengan tombol
// "Live di sini" yang menukar slot live tertua. Satu hitung mundur 3 menit untuk semua tile.

const AUTO_STOP_SECONDS = 180;
const START_STAGGER_MS = 400;

const pad = (n: number) => String(n).padStart(2, "0");
const mmss = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

export function MultiLiveGrid({
    cameras,
    maxLive,
    blockedMessage,
}: {
    cameras: LiveGridCamera[];
    maxLive: number;
    /** alasan live tidak tersedia (akun bermasalah, mode mock); null = boleh live */
    blockedMessage: string | null;
}) {
    const blocked = blockedMessage !== null;
    const containerRef = useRef<HTMLDivElement>(null);
    // Antrean slot live, terlama di depan.
    const [liveIds, setLiveIds] = useState<string[]>(() => (blocked ? [] : pickLiveCameras(cameras, maxLive)));
    const [running, setRunning] = useState(liveIds.length > 0);
    const [runId, setRunId] = useState(0);
    const [remaining, setRemaining] = useState(AUTO_STOP_SECONDS);
    const [soundCameraId, setSoundCameraId] = useState<string | null>(null);

    // Heartbeat tile terdaftar di sini; interaksi pada grid memanggil semuanya (masing-masing di-throttle).
    const beats = useRef(new Set<() => void>());
    const registerBeat = useCallback((beat: () => void) => {
        beats.current.add(beat);
        return () => {
            beats.current.delete(beat);
        };
    }, []);
    const context = useMemo<MultiLiveContextValue>(
        () => ({ registerBeat, soundCameraId, setSoundCameraId }),
        [registerBeat, soundCameraId],
    );

    // Hitung mundur bersama; habis → semua tile dibongkar (sesi server ditutup oleh tile).
    useEffect(() => {
        if (!running) return;
        const id = setInterval(() => {
            setRemaining((r) => {
                if (r <= 1) {
                    setRunning(false);
                    setSoundCameraId(null);
                    return 0;
                }
                return r - 1;
            });
        }, 1000);
        return () => clearInterval(id);
    }, [running]);

    function touch() {
        if (!running) return;
        setRemaining(AUTO_STOP_SECONDS);
        for (const beat of beats.current) beat();
    }

    function startAll(ids = liveIds) {
        if (blocked || ids.length === 0) return;
        setLiveIds(ids);
        setRemaining(AUTO_STOP_SECONDS);
        setRunId((n) => n + 1);
        setRunning(true);
    }

    function stopAll() {
        setRunning(false);
        setSoundCameraId(null);
    }

    function swapIn(cameraId: string) {
        const kept = liveIds.length >= maxLive ? liveIds.slice(liveIds.length - maxLive + 1) : liveIds;
        const next = [...kept, cameraId];
        if (soundCameraId && !next.includes(soundCameraId)) setSoundCameraId(null);
        if (running) {
            setLiveIds(next);
            touch();
        } else {
            startAll(next);
        }
    }

    const liveCount = running ? liveIds.length : 0;
    const startable = !blocked && cameras.some(canGoLive);

    return (
        <MultiLiveContext.Provider value={context}>
            <div
                ref={containerRef}
                onPointerMove={touch}
                onClick={touch}
                className="flex flex-col gap-4 [&:fullscreen]:overflow-auto [&:fullscreen]:bg-background [&:fullscreen]:p-6"
            >
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
                    <div className="flex items-center gap-3">
                        <span
                            className={cn(
                                "flex items-center gap-1.5 rounded-sm px-2 py-[3px] text-[11px] font-bold tracking-[0.06em]",
                                liveCount > 0 ? "bg-alert-badge text-white" : "bg-track text-muted-foreground",
                            )}
                        >
                            <Radio className="size-3.5" />
                            LIVE {liveCount}/{cameras.length}
                        </span>
                        <p className="text-[13px] font-medium text-muted-foreground">
                            {blocked
                                ? blockedMessage
                                : running
                                  ? (
                                      <>
                                          Berhenti otomatis dalam{" "}
                                          <span className="font-mono font-semibold text-foreground">{mmss(remaining)}</span>
                                      </>
                                  )
                                  : `Maks. ${maxLive} kamera live bersamaan per akun`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {running ? (
                            <GridButton icon={Pause} onClick={stopAll}>
                                Jeda semua
                            </GridButton>
                        ) : (
                            <GridButton icon={Play} onClick={() => startAll()} disabled={!startable || liveIds.length === 0}>
                                Lanjutkan semua
                            </GridButton>
                        )}
                        <GridButton icon={Maximize} onClick={() => containerRef.current?.requestFullscreen?.()}>
                            Layar penuh
                        </GridButton>
                    </div>
                </div>

                <div
                    className={cn(
                        "grid grid-cols-1 gap-4",
                        cameras.length === 2 && "md:grid-cols-2",
                        cameras.length >= 3 && "md:grid-cols-2 xl:grid-cols-3",
                        cameras.length === 1 && "mx-auto w-full max-w-5xl",
                    )}
                >
                    {cameras.map((camera) => {
                        const slot = liveIds.indexOf(camera.id);
                        return (
                            <LiveTile
                                key={camera.id}
                                camera={camera}
                                live={running && slot >= 0}
                                startDelayMs={Math.max(0, slot) * START_STAGGER_MS}
                                runId={runId}
                                canSwapIn={!blocked && canGoLive(camera) && !(running && slot >= 0)}
                                onSwapIn={() => swapIn(camera.id)}
                            />
                        );
                    })}
                </div>

                <p className="text-xs font-medium text-subtle">
                    Untuk menghemat kuota 4G dan bandwidth akun EZVIZ, semua live berhenti otomatis setelah 3 menit
                    tanpa interaksi. Mikrofon, PTZ, kualitas HD, dan playback tersedia di halaman detail kamera.
                </p>
            </div>
        </MultiLiveContext.Provider>
    );
}

function GridButton({
    icon: Icon,
    onClick,
    disabled = false,
    children,
}: {
    icon: typeof Play;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            disabled={disabled}
            className="flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-semibold hover:bg-muted disabled:opacity-40"
        >
            <Icon className="size-4" />
            {children}
        </button>
    );
}
