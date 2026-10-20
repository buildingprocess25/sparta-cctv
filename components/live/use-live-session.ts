"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EzopenAccess, EzopenControls } from "./ezopen-player";
import type { PlaybackRange } from "./playback-context";

// Satu sesi live/playback satu kamera: meminta alamat ke /api/cameras/[id]/live, memasang HLS atau
// menyiapkan akses EZUIKit, heartbeat, dan menutup sesi server saat berhenti/error/unmount.
// Dipakai halaman detail (LivePlayer) dan grid multi-live (LiveTile).

export type StreamState = "idle" | "loading" | "playing" | "error";

const HEARTBEAT_MIN_MS = 60_000;

export type LiveSession = {
    state: StreamState;
    playing: boolean;
    error: string | null;
    /** kode penolakan pembatas dari server ("full" | "hd_busy"), bila ada */
    errorCode: string | null;
    /** terisi saat memakai player ezopen; render <EzopenPlayer {...ezopenProps}> */
    ezopen: EzopenAccess | null;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    controlsRef: React.RefObject<EzopenControls | null>;
    start(highQuality?: boolean): Promise<void>;
    stop(): void;
    /** heartbeat langsung (mis. saat frame pertama tampil) */
    heartbeat(): void;
    /** heartbeat bila sudah ≥ 60 dtk sejak yang terakhir; dipanggil tiap ada interaksi */
    beat(): void;
    /** handler untuk EzopenPlayer */
    onEzopenPlaying(): void;
    onEzopenError(message: string): void;
};

export function useLiveSession({
    cameraId,
    playback,
    autoStart = false,
    autoStartDelayMs = 0,
    onStartError,
}: {
    cameraId: string;
    /** mulai otomatis saat mount (setelah autoStartDelayMs) */
    autoStart?: boolean;
    autoStartDelayMs?: number;
    /** bila diisi → putar rekaman MicroSD rentang ini */
    playback?: PlaybackRange;
    onStartError?: (message: string) => void;
}): LiveSession {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const controlsRef = useRef<EzopenControls>(null);
    const [state, setState] = useState<StreamState>(autoStart ? "loading" : "idle");
    const [error, setError] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [ezopen, setEzopen] = useState<EzopenAccess | null>(null);
    const callbacks = useRef({ onStartError });
    useEffect(() => {
        callbacks.current = { onStartError };
    });

    // Sesi server yang sedang dibuka; ditutup saat stop, error, atau unmount agar slot akun
    // (pembatas maks. N sesi per akun) tidak tertahan.
    const sessionRef = useRef<string | null>(null);
    const endSession = useCallback(() => {
        const session = sessionRef.current;
        if (!session) return;
        sessionRef.current = null;
        // keepalive: tetap terkirim walau halaman sedang ditinggalkan
        fetch(`/api/cameras/${encodeURIComponent(cameraId)}/live?session=${encodeURIComponent(session)}`, {
            method: "DELETE",
            keepalive: true,
        }).catch(() => {});
    }, [cameraId]);

    const destroyHls = useCallback(() => {
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
    }, []);

    // Cleanup HLS & sesi saat unmount (pindah halaman, ganti tab live/playback, ganti rentang)
    useEffect(() => {
        return () => {
            destroyHls();
            endSession();
        };
    }, [destroyHls, endSession]);

    function fail(message: string) {
        setError(message);
        setState("error");
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
                setState("playing");
            });
            hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (data.fatal) {
                    console.error("[hls] fatal error:", {
                        type: data.type,
                        details: data.details,
                        url: (data as unknown as Record<string, unknown>).url,
                        response: (data as unknown as Record<string, unknown>).response,
                    });
                    fail(`Stream gagal: ${data.details ?? data.type ?? "unknown"}`);
                    destroyHls();
                    endSession();
                }
            });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Safari — native HLS
            video.src = url;
            video.addEventListener("loadedmetadata", () => {
                video.play().catch(() => {});
                setState("playing");
            }, { once: true });
        } else {
            fail("Browser tidak mendukung HLS");
        }
    }

    async function start(highQuality = false) {
        endSession();
        setState("loading");
        setError(null);
        setErrorCode(null);

        const query = playback
            ? `?begin=${encodeURIComponent(playback.start.toISOString())}&end=${encodeURIComponent(playback.end.toISOString())}`
            : highQuality
              ? "?quality=1"
              : "";
        try {
            const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/live${query}`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setErrorCode(typeof body.code === "string" ? body.code : null);
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            const body = (await res.json()) as (
                | ({ kind: "ezopen"; expiresAt: string } & EzopenAccess)
                | { kind: "hls"; url: string; expiresAt: string }
            ) & { sessionId: string | null };
            sessionRef.current = body.sessionId;
            if (body.kind === "ezopen") {
                // Status "playing" diset lewat onEzopenPlaying saat frame pertama tampil.
                setEzopen({ url: body.url, accessToken: body.accessToken, domain: body.domain });
            } else {
                attachHls(body.url);
            }
        } catch (err) {
            setEzopen(null);
            const msg = err instanceof Error ? err.message : "Gagal memulai stream";
            fail(msg);
            callbacks.current.onStartError?.(msg);
        }
    }

    function stop() {
        destroyHls();
        setEzopen(null);
        const video = videoRef.current;
        if (video) {
            video.pause();
            video.removeAttribute("src");
            video.load();
        }
        // Beritahu server agar sesi ditutup (fire-and-forget)
        endSession();
        setState("idle");
        setError(null);
        setErrorCode(null);
    }

    const lastBeat = useRef(0);
    const heartbeat = useCallback(() => {
        lastBeat.current = Date.now();
        fetch(`/api/cameras/${encodeURIComponent(cameraId)}/live`, { method: "PATCH" }).catch(() => {});
    }, [cameraId]);
    const beat = useCallback(() => {
        // Heartbeat ke server (maks. 1x per 60 dtk) agar sesi/alamat stream diperpanjang.
        if (Date.now() - lastBeat.current < HEARTBEAT_MIN_MS) return;
        heartbeat();
    }, [heartbeat]);

    useEffect(() => {
        if (!autoStart) return;
        const t = setTimeout(() => void start(), autoStartDelayMs);
        return () => clearTimeout(t);
    // Hanya saat mount; start membaca props terbaru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        state,
        playing: state === "playing",
        error,
        errorCode,
        ezopen,
        videoRef,
        controlsRef,
        start,
        stop,
        heartbeat,
        beat,
        onEzopenPlaying() {
            setState("playing");
            // Server membuat sesi ezopen "pending" (60 dtk); frame pertama → perpanjang ke 3 menit.
            heartbeat();
        },
        onEzopenError(message) {
            setEzopen(null);
            fail(message);
            endSession();
        },
    };
}
