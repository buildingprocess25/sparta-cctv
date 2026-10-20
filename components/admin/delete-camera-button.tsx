"use client";

import { useTransition } from "react";
import type { FormState } from "@/app/(app)/pengaturan/ezviz/state";
import { Trash2 } from "lucide-react";

export function DeleteCameraButton({
    cameraId,
    label,
    action,
}: {
    cameraId: string;
    label: string;
    action: (cameraId: string) => Promise<FormState>;
}) {
    const [pending, startTransition] = useTransition();

    function handleClick() {
        if (!confirm(`Hapus kamera "${label}"? Semua riwayat event juga akan ikut terhapus.`)) return;
        startTransition(async () => {
            const result = await action(cameraId);
            if (result && !result.ok) {
                alert(result.message);
            }
        });
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={pending}
            title={`Hapus kamera ${label}`}
            aria-label={`Hapus kamera ${label}`}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-status-offline group-hover:opacity-100 disabled:opacity-50"
        >
            <Trash2 className="size-3.5" />
        </button>
    );
}
