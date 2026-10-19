"use client";

import { useState, useTransition } from "react";
import type { SyncState } from "@/app/(app)/pengaturan/ezviz/state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SyncPanel({ action, disabled }: { action: () => Promise<SyncState>; disabled?: boolean }) {
    const [state, setState] = useState<SyncState>(null);
    const [pending, start] = useTransition();

    return (
        <div className="flex flex-col gap-3">
            <div>
                <Button
                    type="button"
                    variant="outline"
                    disabled={pending || disabled}
                    onClick={() => start(async () => setState(await action()))}
                    className="h-9 rounded-lg px-4 text-[13px] font-semibold"
                >
                    {pending ? "Membandingkan…" : "Sinkronkan perangkat"}
                </Button>
            </div>

            {state && !state.ok && (
                <p role="status" className="text-[12.5px] font-medium text-status-offline">
                    {state.message}
                </p>
            )}

            {state?.ok && (
                <div role="status" className="flex flex-col gap-3 text-[12.5px] font-medium">
                    <p className="text-muted-foreground">
                        {state.deviceCount} perangkat di akun EZVIZ · {state.diff.matched.length} cocok dengan kamera sistem
                        {state.diff.unmappedCameras > 0 && ` · ${state.diff.unmappedCameras} kamera belum punya serial`}
                    </p>
                    {state.overLimit && <p className="font-semibold text-status-warning">Jumlah perangkat melebihi batas paket Free.</p>}

                    <DiffList
                        title="Ada di EZVIZ, belum dipetakan ke kamera"
                        tone="text-status-warning"
                        empty="Semua perangkat sudah dipetakan."
                        items={state.diff.onlyInEzviz.map((d) => ({ key: d.deviceSerial, text: `${d.deviceSerial} · ${d.deviceName}` }))}
                    />
                    <DiffList
                        title="Dipetakan di sistem, tidak ada di akun EZVIZ"
                        tone="text-status-offline"
                        empty="Semua serial di sistem ada di akun EZVIZ."
                        items={state.diff.onlyInSystem.map((c) => ({ key: c.cameraId, text: `${c.deviceSerial} · ${c.label} (${c.storeName})` }))}
                    />
                    <DiffList
                        title="Cocok"
                        tone="text-status-online"
                        empty="Belum ada yang cocok."
                        items={state.diff.matched.map((m) => ({
                            key: m.cameraId,
                            text: `${m.deviceSerial} · ${m.label} (${m.storeName}) · ${m.online === null ? "belum melapor" : m.online ? "online" : "offline"}`,
                        }))}
                    />
                </div>
            )}
        </div>
    );
}

function DiffList({ title, tone, items, empty }: { title: string; tone: string; items: { key: string; text: string }[]; empty: string }) {
    return (
        <div>
            <p className={cn("mb-1 font-semibold", tone)}>
                {title} ({items.length})
            </p>
            {items.length === 0 ? (
                <p className="text-subtle">{empty}</p>
            ) : (
                <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
                    {items.map((i) => (
                        <li key={i.key}>{i.text}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}
