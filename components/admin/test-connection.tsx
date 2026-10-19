"use client";

import { useState, useTransition } from "react";
import type { TestState } from "@/app/(app)/pengaturan/ezviz/state";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatTimeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TestConnection({ action, disabled }: { action: () => Promise<TestState>; disabled?: boolean }) {
    const [state, setState] = useState<TestState>(null);
    const [pending, start] = useTransition();

    return (
        <div className="flex flex-col gap-2">
            <div>
                <Button
                    type="button"
                    variant="outline"
                    disabled={pending || disabled}
                    onClick={() => start(async () => setState(await action()))}
                    className="h-9 rounded-lg px-4 text-[13px] font-semibold"
                >
                    {pending ? "Menguji…" : "Uji koneksi"}
                </Button>
            </div>
            {state && (
                <div
                    role="status"
                    className={cn(
                        "rounded-lg border p-3 text-[12.5px] font-medium",
                        state.ok ? "border-status-online/30 bg-status-online/5" : "border-status-offline/30 bg-status-offline/5",
                    )}
                >
                    <p className={state.ok ? "text-status-online" : "text-status-offline"}>{state.message}</p>
                    {state.ok && (
                        <ul className="mt-1.5 flex flex-col gap-0.5 text-muted-foreground">
                            <li>{state.deviceCount} perangkat ditemukan di akun.</li>
                            <li>
                                Token berlaku sampai {formatDateTime(new Date(state.tokenExpiresAt))} (
                                {formatTimeLeft(new Date(state.tokenExpiresAt))}).
                            </li>
                            <li>
                                Server wilayah: <span className="font-mono">{state.areaDomain}</span>
                            </li>
                            {state.overLimit && (
                                <li className="font-semibold text-status-warning">
                                    Jumlah perangkat melebihi batas paket. Kurangi perangkat di akun EZVIZ kontraktor.
                                </li>
                            )}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
