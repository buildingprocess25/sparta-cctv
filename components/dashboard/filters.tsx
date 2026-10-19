"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS = [
    { value: "all", label: "Semua" },
    { value: "online", label: "Online" },
    { value: "offline", label: "Offline" },
    { value: "unstable", label: "Tidak stabil" },
    { value: "unknown", label: "Tidak diketahui" },
    { value: "sd", label: "MicroSD bermasalah" },
];

export function DashboardFilters({
    contractors,
    compact = false,
}: {
    contractors: string[];
    /** Mobile: hanya filter kontraktor, tanpa label */
    compact?: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();

    function update(key: string, value: string) {
        const next = new URLSearchParams(params.toString());
        if (value === "all") next.delete(key);
        else next.set(key, value);
        router.push(`${pathname}${next.size ? `?${next}` : ""}`);
    }

    return (
        <div className="flex flex-wrap gap-2">
            <FilterSelect
                label="Kontraktor"
                hideLabel={compact}
                value={params.get("kontraktor") ?? "all"}
                onChange={(v) => update("kontraktor", v)}
                options={[
                    {
                        value: "all",
                        label: compact ? "Semua kontraktor" : `Semua (${contractors.length})`,
                    },
                    ...contractors.map((c) => ({ value: c, label: c })),
                ]}
            />
            {!compact && (
                <FilterSelect
                    label="Status"
                    value={params.get("status") ?? "all"}
                    onChange={(v) => update("status", v)}
                    options={STATUS_OPTIONS}
                />
            )}
        </div>
    );
}

function FilterSelect({
    label,
    hideLabel,
    value,
    onChange,
    options,
}: {
    label: string;
    hideLabel?: boolean;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger
                aria-label={label}
                className="h-[34px] gap-2 rounded-lg border bg-white px-3 text-[12.5px] font-semibold shadow-none lg:text-[13px]"
            >
                {!hideLabel && <span className="font-medium text-subtle">{label}</span>}
                <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
                {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
