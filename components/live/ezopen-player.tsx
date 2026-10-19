"use client";

import { useEffect, useId, useRef } from "react";

// Player ezopen resmi EZVIZ (EZUIKit). Dipakai untuk kamera baterai/4G (mis. EB8) yang tidak bisa
// diputar lewat HLS standar. Modul hanya jalan di browser, jadi di-import dinamis.

export type EzopenAccess = { url: string; accessToken: string; domain: string };

type Player = { stop?: () => Promise<unknown> | void; destroy?: () => Promise<unknown> | void };

export function EzopenPlayer({
    access,
    onPlaying,
    onError,
}: {
    access: EzopenAccess;
    onPlaying: () => void;
    onError: (message: string) => void;
}) {
    const domId = `ezopen-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
    const containerRef = useRef<HTMLDivElement>(null);
    const callbacks = useRef({ onPlaying, onError });
    useEffect(() => {
        callbacks.current = { onPlaying, onError };
    });

    useEffect(() => {
        let player: Player | null = null;
        let cancelled = false;

        (async () => {
            const { EZUIKitPlayer } = await import("ezuikit-js");
            const el = containerRef.current;
            if (cancelled || !el) return;
            player = new EZUIKitPlayer({
                id: domId,
                url: access.url,
                accessToken: access.accessToken,
                env: { domain: access.domain },
                template: "simple",
                audio: false,
                width: el.clientWidth,
                height: el.clientHeight,
                handleSuccess: () => callbacks.current.onPlaying(),
                handleError: (err: unknown) => {
                    console.error("[ezopen] error:", err);
                    const e = err as { msg?: string; retcode?: number | string; data?: { nErrorCode?: number } };
                    const code = e?.retcode ?? e?.data?.nErrorCode;
                    callbacks.current.onError(e?.msg ? `${e.msg}${code ? ` (${code})` : ""}` : "Stream gagal");
                },
            }) as Player;
        })().catch((error) => {
            console.error("[ezopen] gagal memuat player:", error);
            callbacks.current.onError("Gagal memuat player EZVIZ");
        });

        return () => {
            cancelled = true;
            try {
                void player?.destroy?.();
            } catch {
                // abaikan
            }
        };
    }, [access.url, access.accessToken, access.domain, domId]);

    return <div id={domId} ref={containerRef} className="absolute inset-0 [&_canvas]:!h-full [&_canvas]:!w-full" />;
}
