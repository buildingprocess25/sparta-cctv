"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function SearchBox({ className }: { className?: string }) {
    const router = useRouter();
    const params = useSearchParams();
    const [value, setValue] = useState(params.get("q") ?? "");

    function submit(e: React.FormEvent) {
        e.preventDefault();
        const next = new URLSearchParams(params.toString());
        if (value.trim()) next.set("q", value.trim());
        else next.delete("q");
        router.push(`/${next.size ? `?${next}` : ""}`);
    }

    return (
        <form
            onSubmit={submit}
            role="search"
            className={cn(
                "flex h-[38px] w-full max-w-[380px] items-center gap-2 rounded-lg bg-muted px-3",
                className,
            )}
        >
            <Search className="size-[17px] shrink-0 text-subtle" />
            <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Cari toko, kode toko, atau kontraktor"
                aria-label="Cari toko, kode toko, atau kontraktor"
                className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-subtle"
            />
        </form>
    );
}
