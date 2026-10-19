"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import type { PtzMove } from "@/lib/cameras/gateway";
import { cn } from "@/lib/utils";

// D-pad pan/tilt: tekan-tahan untuk bergerak, lepas untuk berhenti. Perintah dikirim berurutan
// (stop selalu menyusul start yang masih berjalan) karena kamera terus berputar sampai menerima stop.

const BUTTONS: { move: PtzMove; label: string; Icon: typeof ChevronUp; className: string }[] = [
    { move: "up", label: "Putar ke atas", Icon: ChevronUp, className: "top-0 left-1/2 -translate-x-1/2" },
    { move: "down", label: "Putar ke bawah", Icon: ChevronDown, className: "bottom-0 left-1/2 -translate-x-1/2" },
    { move: "left", label: "Putar ke kiri", Icon: ChevronLeft, className: "top-1/2 left-0 -translate-y-1/2" },
    { move: "right", label: "Putar ke kanan", Icon: ChevronRight, className: "top-1/2 right-0 -translate-y-1/2" },
];

export function PtzPad({
    cameraId,
    onInteract,
    className,
}: {
    cameraId: string;
    onInteract: () => void;
    className?: string;
}) {
    const queue = useRef<Promise<void>>(Promise.resolve());
    const active = useRef<PtzMove | null>(null);

    const send = useCallback(
        (body: { action: "start"; move: PtzMove } | { action: "stop" }) => {
            queue.current = queue.current.then(async () => {
                try {
                    const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/ptz`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                        keepalive: body.action === "stop",
                    });
                    if (res.ok || body.action === "stop") return;
                    const data = (await res.json().catch(() => ({}))) as { error?: string; limit?: boolean };
                    if (data.limit) toast.info(data.error ?? "Kamera sudah di batas putar", { id: "ptz-limit" });
                    else toast.error(`PTZ gagal: ${data.error ?? `HTTP ${res.status}`}`, { id: "ptz-error" });
                } catch {
                    if (body.action === "start") toast.error("PTZ gagal: tidak dapat terhubung", { id: "ptz-error" });
                }
            });
        },
        [cameraId],
    );

    const start = (move: PtzMove) => {
        if (active.current === move) return;
        if (active.current) send({ action: "stop" });
        active.current = move;
        onInteract();
        send({ action: "start", move });
    };

    const stop = useCallback(() => {
        if (!active.current) return;
        active.current = null;
        send({ action: "stop" });
    }, [send]);

    // Jangan biarkan kamera terus berputar bila tab disembunyikan atau panel ditutup.
    useEffect(() => {
        const onHide = () => stop();
        window.addEventListener("blur", onHide);
        document.addEventListener("visibilitychange", onHide);
        return () => {
            window.removeEventListener("blur", onHide);
            document.removeEventListener("visibilitychange", onHide);
            stop();
        };
    }, [stop]);

    const pointerDown = (move: PtzMove) => (e: PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start(move);
    };
    const keyDown = (move: PtzMove) => (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (!e.repeat) start(move);
    };
    const keyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Enter" || e.key === " ") stop();
    };

    return (
        <div
            role="group"
            aria-label="Kontrol putar kamera"
            onClick={(e) => e.stopPropagation()}
            className={cn(
                "relative size-[104px] touch-none rounded-full border border-white/15 bg-[#0b0d11]/55 backdrop-blur-[8px] select-none lg:size-[132px]",
                className,
            )}
        >
            {BUTTONS.map(({ move, label, Icon, className: pos }) => (
                <button
                    key={move}
                    type="button"
                    aria-label={label}
                    onPointerDown={pointerDown(move)}
                    onPointerUp={stop}
                    onPointerCancel={stop}
                    onLostPointerCapture={stop}
                    onKeyDown={keyDown(move)}
                    onKeyUp={keyUp}
                    onBlur={stop}
                    onContextMenu={(e) => e.preventDefault()}
                    className={cn(
                        "absolute flex size-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white active:bg-white/30 lg:size-11",
                        pos,
                    )}
                >
                    <Icon className="size-5 lg:size-6" />
                </button>
            ))}
            <span className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30" />
        </div>
    );
}
