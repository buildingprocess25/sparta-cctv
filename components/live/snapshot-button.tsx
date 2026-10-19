"use client";

import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export async function takeSnapshot(cameraId: string): Promise<boolean> {
    try {
        const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/snapshot`, { method: "POST" });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        toast.success("Snapshot diperbarui");
        return true;
    } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal mengambil snapshot");
        return false;
    }
}

export function SnapshotButton({ cameraId }: { cameraId: string }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    async function onClick() {
        setBusy(true);
        if (await takeSnapshot(cameraId)) router.refresh();
        setBusy(false);
    }

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg border bg-white py-2 pr-3.5 pl-3 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
        >
            <Camera className="size-4" />
            {busy ? "Mengambil…" : "Ambil snapshot"}
        </button>
    );
}
