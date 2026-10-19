"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/app/(app)/pengaturan/ezviz/state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ToggleAccount({ enabled, action }: { enabled: boolean; action: (enable: boolean) => Promise<FormState> }) {
    const [state, setState] = useState<FormState>(null);
    const [pending, start] = useTransition();

    return (
        <div className="flex flex-col gap-2">
            <div>
                <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                        if (enabled && !window.confirm("Nonaktifkan akun? Pengecekan semua kamera kontraktor ini berhenti.")) return;
                        start(async () => setState(await action(!enabled)));
                    }}
                    className={cn("h-9 rounded-lg px-4 text-[13px] font-semibold", enabled && "text-status-offline")}
                >
                    {pending ? "Memproses…" : enabled ? "Nonaktifkan akun" : "Aktifkan akun"}
                </Button>
            </div>
            {state && (
                <p role="status" className={cn("text-[12.5px] font-medium", state.ok ? "text-status-online" : "text-status-offline")}>
                    {state.message}
                </p>
            )}
        </div>
    );
}
