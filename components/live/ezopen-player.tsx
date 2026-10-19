"use client";

import type { EZUIKitPlayer as EzPlayer } from "ezuikit-js";
import { useEffect, useId, useImperativeHandle, useRef, type Ref } from "react";

// Player ezopen resmi EZVIZ (EZUIKit). Dipakai untuk kamera baterai/4G (mis. EB8) yang tidak bisa
// diputar lewat HLS standar. Modul hanya jalan di browser, jadi di-import dinamis.
// Template "simple" (tanpa tombol bawaan); kontrol disediakan lewat `controlsRef` agar UI-nya
// mengikuti desain dashboard.

export type EzopenAccess = { url: string; accessToken: string; domain: string };

/** Kontrol player untuk panel live. Semua no-op bila player belum siap. */
export type EzopenControls = {
    setSound(on: boolean): Promise<void>;
    /** Hasil (berhasil/gagal) dilaporkan lewat onTalkChange. Butuh HTTPS + izin mikrofon. */
    startTalk(): void;
    stopTalk(): void;
    /** Zoom digital: setelah aktif, gulir/cubit di video untuk memperbesar. */
    setZoom(on: boolean): Promise<void>;
    /** Rekam klip di browser; berkas diunduh saat stopRecording. */
    startRecording(fileName: string): Promise<void>;
    stopRecording(): Promise<void>;
};

export type TalkChange = { state: "on" } | { state: "off" } | { state: "error"; message: string };

export function EzopenPlayer({
    access,
    onPlaying,
    onError,
    onTalkChange,
    controlsRef,
}: {
    access: EzopenAccess;
    onPlaying: () => void;
    onError: (message: string) => void;
    onTalkChange?: (change: TalkChange) => void;
    controlsRef?: Ref<EzopenControls>;
}) {
    const domId = `ezopen-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<EzPlayer | null>(null);
    const callbacks = useRef({ onPlaying, onError, onTalkChange });
    useEffect(() => {
        callbacks.current = { onPlaying, onError, onTalkChange };
    });

    useImperativeHandle(
        controlsRef,
        () => ({
            async setSound(on) {
                await (on ? playerRef.current?.openSound() : playerRef.current?.closeSound());
            },
            startTalk() {
                playerRef.current?.startTalk();
            },
            stopTalk() {
                playerRef.current?.stopTalk();
            },
            async setZoom(on) {
                await (on ? playerRef.current?.enableZoom() : playerRef.current?.closeZoom());
            },
            async startRecording(fileName) {
                await playerRef.current?.startSave(fileName);
            },
            async stopRecording() {
                await playerRef.current?.stopSave();
            },
        }),
        [],
    );

    useEffect(() => {
        let cancelled = false;
        let resizeObserver: ResizeObserver | null = null;

        (async () => {
            const { EZUIKitPlayer } = await import("ezuikit-js");
            const el = containerRef.current;
            if (cancelled || !el) return;
            const player = new EZUIKitPlayer({
                id: domId,
                url: access.url,
                accessToken: access.accessToken,
                env: { domain: access.domain },
                template: "simple",
                audio: false,
                plugin: ["talk"],
                width: el.clientWidth,
                height: el.clientHeight,
                handleSuccess: () => callbacks.current.onPlaying(),
                handleError: (err: unknown) => {
                    console.error("[ezopen] error:", err);
                    const e = err as { msg?: string; retcode?: number | string; data?: { nErrorCode?: number } };
                    const code = e?.retcode ?? e?.data?.nErrorCode;
                    callbacks.current.onError(e?.msg ? `${e.msg}${code ? ` (${code})` : ""}` : "Stream gagal");
                },
            });
            playerRef.current = player;

            // EZUIKit mengunci ukuran saat dibuat (bisa 0 bila tata letak belum selesai) dan tidak
            // mengikuti layar penuh; sesuaikan setiap kali wadah berubah ukuran.
            resizeObserver = new ResizeObserver(() => {
                const w = el.clientWidth;
                const h = el.clientHeight;
                if (w > 0 && h > 0) playerRef.current?.resize(w, h);
            });
            resizeObserver.observe(el);

            const events = EZUIKitPlayer.EVENTS ?? {};
            const name = (key: string) => (typeof events[key] === "string" ? (events[key] as string) : key);
            player.eventEmitter?.on(name("talkSuccess"), () => callbacks.current.onTalkChange?.({ state: "on" }));
            player.eventEmitter?.on(name("stopTalk"), () => callbacks.current.onTalkChange?.({ state: "off" }));
            player.eventEmitter?.on(name("talkError"), (err) => {
                console.error("[ezopen] talk error:", err);
                const e = err as { msg?: string; data?: { msg?: string } } | undefined;
                callbacks.current.onTalkChange?.({
                    state: "error",
                    message: e?.msg ?? e?.data?.msg ?? "Mikrofon tidak dapat dipakai",
                });
            });
        })().catch((error) => {
            console.error("[ezopen] gagal memuat player:", error);
            callbacks.current.onError("Gagal memuat player EZVIZ");
        });

        return () => {
            cancelled = true;
            resizeObserver?.disconnect();
            const player = playerRef.current;
            playerRef.current = null;
            try {
                void player?.destroy?.();
            } catch {
                // abaikan
            }
        };
    }, [access.url, access.accessToken, access.domain, domId]);

    // Wadah luar yang diukur; EZUIKit menulis width/height inline ke div ber-id di dalamnya.
    return (
        <div ref={containerRef} className="absolute inset-0 overflow-hidden">
            <div id={domId} className="[&_canvas]:!h-full [&_canvas]:!w-full" />
        </div>
    );
}
