"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { RecordingSegment } from "@/lib/monitoring";

const pad = (n: number) => String(n).padStart(2, "0");
const DAY = 1440;
const pct = (minutes: number) => `${(minutes / DAY) * 100}%`;

export function PlaybackCard({
    recordings,
    nowMinutes,
    dateLabel,
    shortDateLabel,
    note,
}: {
    recordings: RecordingSegment[];
    nowMinutes: number;
    dateLabel: string;
    shortDateLabel: string;
    /** pesan pengganti keterangan bawaan (mis. rekaman gagal dimuat) */
    note?: string | null;
}) {
    const [startHour, setStartHour] = useState(Math.max(0, Math.floor(nowMinutes / 60) - 1));

    const rangeOptions = Array.from({ length: 24 }, (_, h) => ({
        value: String(h),
        label: `${pad(h)}:00 – ${pad(h + 1)}:00`,
    }));

    const range = (
        <Select value={String(startHour)} onValueChange={(v) => setStartHour(Number(v))}>
            <SelectTrigger
                aria-label="Rentang jam"
                className="h-[34px] rounded-lg border bg-white px-2.5 font-mono text-[12.5px] font-medium shadow-none lg:text-[13px]"
            >
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {rangeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="font-mono">
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
    const play = (
        <Button
            onClick={() => toast.info("Pemutaran rekaman tersedia setelah integrasi EZVIZ selesai.")}
            className="h-[34px] rounded-lg px-3.5 text-[13px] font-semibold max-lg:flex-1"
        >
            Putar rekaman
        </Button>
    );

    return (
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:gap-3.5 lg:px-5 lg:pt-[18px] lg:pb-5">
            <header className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold lg:text-[15px]">Rekaman MicroSD</h2>
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-lg border bg-white py-[5px] pr-2 pl-2 text-[12.5px] font-semibold lg:py-[7px] lg:pl-2.5 lg:text-[13px]">
                        <CalendarDays className="size-3.5 lg:size-[15px]" />
                        <span className="lg:hidden">{shortDateLabel}</span>
                        <span className="hidden lg:inline">{dateLabel}</span>
                    </span>
                    <span className="hidden items-center gap-2 lg:flex">
                        {range}
                        {play}
                    </span>
                </div>
            </header>

            <Timeline
                recordings={recordings}
                nowMinutes={nowMinutes}
                selectedStart={startHour * 60}
            />

            <div className="flex gap-2 lg:hidden">
                {range}
                {play}
            </div>

            <p className={note ? "text-xs font-medium text-status-warning" : "hidden text-xs font-medium text-subtle lg:block"}>
                {note ?? "Bagian abu-abu: tidak ada rekaman pada jam tersebut (kamera offline atau tidak merekam)."}
            </p>
        </section>
    );
}

function Timeline({
    recordings,
    nowMinutes,
    selectedStart,
}: {
    recordings: RecordingSegment[];
    nowMinutes: number;
    selectedStart: number;
}) {
    const labels = Array.from({ length: 9 }, (_, i) => i * 3);

    return (
        <div className="relative h-[46px] lg:h-[58px]" role="img" aria-label="Timeline rekaman 24 jam">
            <div className="absolute inset-x-0 top-1 h-5 rounded bg-track lg:top-2 lg:h-6">
                {recordings.map((seg) => (
                    <span
                        key={seg.startMin}
                        className="absolute inset-y-0 rounded-[3px] bg-primary/80"
                        style={{ left: pct(seg.startMin), width: pct(seg.endMin - seg.startMin) }}
                    />
                ))}
            </div>
            <span
                className="absolute top-px h-[26px] rounded border-2 border-foreground lg:top-1 lg:h-8"
                style={{ left: pct(selectedStart), width: pct(60) }}
            />
            <span
                className="absolute top-0.5 hidden h-9 w-0.5 bg-alert-badge lg:block"
                style={{ left: pct(nowMinutes) }}
            />
            {labels.map((h) => (
                <span
                    key={h}
                    className={
                        "absolute top-[30px] font-mono text-[10.5px] font-medium text-subtle lg:top-[42px] lg:text-[11px] " +
                        (h % 6 !== 0 ? "max-lg:hidden " : "") +
                        (h === 24 ? "-translate-x-full" : h === 0 ? "" : "-translate-x-1/2")
                    }
                    style={{ left: `${(h / 24) * 100}%` }}
                >
                    <span className="lg:hidden">{pad(h)}</span>
                    <span className="hidden lg:inline">{pad(h)}:00</span>
                </span>
            ))}
        </div>
    );
}
