"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(app)/pengaturan/ezviz/state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContractorCamera } from "@/lib/ezviz/admin-store";
import { cn } from "@/lib/utils";

export function SerialsForm({
    action,
    cameras,
    mapped,
    limit,
}: {
    action: (prev: FormState, formData: FormData) => Promise<FormState>;
    cameras: ContractorCamera[];
    mapped: number;
    limit: number;
}) {
    const [state, formAction, pending] = useActionState(action, null);

    const stores = new Map<string, { name: string; code: string; cameras: ContractorCamera[] }>();
    for (const c of cameras) {
        const group = stores.get(c.storeId) ?? { name: c.storeName, code: c.storeCode, cameras: [] };
        group.cameras.push(c);
        stores.set(c.storeId, group);
    }

    if (cameras.length === 0) {
        return <p className="text-[13px] font-medium text-muted-foreground">Kontraktor ini belum memiliki toko/kamera.</p>;
    }

    return (
        <form action={formAction} className="flex flex-col gap-4">
            <p className={cn("text-[13px] font-semibold", mapped >= limit ? "text-status-warning" : "text-muted-foreground")}>
                {mapped}/{limit} perangkat terpetakan
            </p>

            {[...stores.entries()].map(([storeId, group]) => (
                <fieldset key={storeId} className="flex flex-col gap-2">
                    <legend className="mb-1 flex items-baseline gap-2 text-[13px] font-semibold">
                        {group.name} <span className="font-mono text-xs font-medium text-subtle">{group.code}</span>
                    </legend>
                    {group.cameras.map((c) => (
                        <div key={c.id} className="grid grid-cols-1 items-start gap-1.5 sm:grid-cols-[150px_1fr] sm:gap-3">
                            <label htmlFor={`serial-${c.id}`} className="pt-2 text-[12.5px] font-medium text-muted-foreground">
                                {c.label} · {c.area}
                            </label>
                            <div className="flex flex-col gap-1">
                                <Input
                                    id={`serial-${c.id}`}
                                    name={`serial:${c.id}`}
                                    defaultValue={c.deviceSerial ?? ""}
                                    placeholder="Serial perangkat (9 karakter di badan kamera)"
                                    autoComplete="off"
                                    spellCheck={false}
                                    maxLength={20}
                                    aria-invalid={Boolean(state?.errors?.[c.id])}
                                    className="font-mono uppercase"
                                />
                                {state?.errors?.[c.id] && <p className="text-xs font-medium text-status-offline">{state.errors[c.id]}</p>}
                            </div>
                        </div>
                    ))}
                </fieldset>
            ))}

            <div className="flex items-center gap-3">
                <Button type="submit" disabled={pending} className="h-9 rounded-lg px-4 text-[13px] font-semibold">
                    {pending ? "Menyimpan…" : "Simpan serial"}
                </Button>
                {state && (
                    <p role="status" className={cn("text-[12.5px] font-medium", state.ok ? "text-status-online" : "text-status-offline")}>
                        {state.message}
                    </p>
                )}
            </div>
        </form>
    );
}
