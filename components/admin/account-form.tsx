"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(app)/pengaturan/ezviz/state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AccountForm({
    action,
    defaultAppKey,
    hasAccount,
}: {
    action: (prev: FormState, formData: FormData) => Promise<FormState>;
    defaultAppKey: string;
    hasAccount: boolean;
}) {
    const [state, formAction, pending] = useActionState(action, null);

    return (
        <form action={formAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                appKey
                <Input name="appKey" defaultValue={defaultAppKey} required autoComplete="off" spellCheck={false} className="font-mono" />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                appSecret
                <Input
                    name="appSecret"
                    type="password"
                    autoComplete="new-password"
                    required={!hasAccount}
                    placeholder={hasAccount ? "•••••••• (kosongkan bila tidak diganti)" : ""}
                    className="font-mono"
                />
            </label>
            <div className="flex items-center gap-3">
                <Button type="submit" disabled={pending} className="h-9 rounded-lg px-4 text-[13px] font-semibold">
                    {pending ? "Menyimpan…" : hasAccount ? "Simpan perubahan" : "Buat akun"}
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
