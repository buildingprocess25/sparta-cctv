"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/app/(app)/pengaturan/ezviz/state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StoreSummary } from "@/lib/ezviz/admin-store";
import { cn } from "@/lib/utils";

export function AddCameraForm({
    action,
    stores,
}: {
    action: (prev: FormState, formData: FormData) => Promise<FormState>;
    stores: StoreSummary[];
}) {
    const [state, formAction, pending] = useActionState(action, null);
    const formRef = useRef<HTMLFormElement>(null);

    // Reset form setelah berhasil tambah
    useEffect(() => {
        if (state?.ok) {
            formRef.current?.reset();
        }
    }, [state]);

    if (stores.length === 0) {
        return (
            <p className="text-[13px] font-medium text-muted-foreground">
                Tidak ada toko terdaftar untuk kontraktor ini.
            </p>
        );
    }

    return (
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                {/* Pilih toko */}
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-cam-store" className="text-[12px] font-medium text-muted-foreground">
                        Toko
                    </label>
                    <select
                        id="add-cam-store"
                        name="storeId"
                        required
                        className="h-9 rounded-md border border-input bg-background px-3 text-[13px] font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {stores.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name} ({s.code})
                            </option>
                        ))}
                    </select>
                </div>

                {/* Label kamera */}
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="add-cam-label" className="text-[12px] font-medium text-muted-foreground">
                        Label kamera
                    </label>
                    <Input
                        id="add-cam-label"
                        name="label"
                        required
                        placeholder="Contoh: CAM-02"
                        maxLength={20}
                        className="h-9 font-mono uppercase"
                        autoComplete="off"
                        spellCheck={false}
                    />
                </div>

                {/* Area */}
                <div className="flex flex-col gap-1.5 sm:col-span-1">
                    <label htmlFor="add-cam-area" className="text-[12px] font-medium text-muted-foreground">
                        Area
                    </label>
                    <Input
                        id="add-cam-area"
                        name="area"
                        required
                        placeholder="Contoh: Area belakang"
                        maxLength={100}
                        className="h-9"
                        autoComplete="off"
                    />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button
                    type="submit"
                    disabled={pending}
                    variant="outline"
                    className="h-9 rounded-lg px-4 text-[13px] font-semibold"
                >
                    {pending ? "Menambahkan…" : "+ Tambah kamera"}
                </Button>
                {state && (
                    <p
                        role="status"
                        className={cn(
                            "text-[12.5px] font-medium",
                            state.ok ? "text-status-online" : "text-status-offline",
                        )}
                    >
                        {state.message}
                    </p>
                )}
            </div>
        </form>
    );
}
