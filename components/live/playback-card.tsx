"use client";

import { CalendarDays } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { GatewayErrorKind } from "@/lib/cameras/errors";
import { formatDateChip, formatDayMonth } from "@/lib/format";
import type { RecordingSegment } from "@/lib/monitoring";
import { usePlayback } from "./playback-context";

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const DAY = 1440;
const SPAN = 60; // panjang rentang yang diputar (menit)
const pct = (minutes: number) => `${(minutes / DAY) * 100}%`;

/** 00:00 WIB untuk kunci "yyyy-MM-dd". */
const dayStartOf = (dateKey: string) => new Date(`${dateKey}T00:00:00+07:00`);

const RECORDINGS_NOTE: Record<GatewayErrorKind, string> = {
    account_unavailable: "Rekaman tidak dapat dimuat: akun EZVIZ kontraktor bermasalah.",
    offline: "Rekaman tidak dapat dimuat: kamera offline.",
    not_found: "Rekaman belum tersedia: serial perangkat belum terdaftar.",
    unsupported: "Perangkat ini tidak mendukung daftar rekaman.",
    ptz_limit: "Rekaman gagal dimuat. Coba muat ulang halaman.", // tidak terjadi untuk daftar rekaman
    rate_limited: "Batas panggilan EZVIZ tercapai. Coba lagi beberapa saat.",
    transient: "Rekaman gagal dimuat. Coba lagi beberapa saat.",
};

type RecordingsResponse = { recordings: RecordingSegment[]; recordingsError: GatewayErrorKind | null };

export function PlaybackCard({
    cameraId,
    todayKey,
    initialRecordings,
    initialError,
    initialNowMinutes,
}: {
    cameraId: string;
    /** tanggal hari ini (WIB), "yyyy-MM-dd" */
    todayKey: string;
    initialRecordings: RecordingSegment[];
    initialError: GatewayErrorKind | null;
    initialNowMinutes: number;
}) {
    const { play } = usePlayback();
    const [dateKey, setDateKey] = useState(todayKey);
    const [recordings, setRecordings] = useState(initialRecordings);
    const [error, setError] = useState(initialError);
    const [nowMinutes, setNowMinutes] = useState(initialNowMinutes);
    const [loading, setLoading] = useState(false);
    const [selectedStart, setSelectedStart] = useState(Math.max(0, Math.floor(initialNowMinutes / 60) - 1) * 60);

    const isToday = dateKey === todayKey;
    const dayStart = dayStartOf(dateKey);

    async function fetchRecordings(key: string): Promise<RecordingSegment[] | null> {
        setLoading(true);
        try {
            const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/recordings?date=${key}`, {
                cache: "no-store",
            });
            const body = (await res.json().catch(() => ({}))) as Partial<RecordingsResponse> & { error?: string };
            if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
            setRecordings(body.recordings ?? []);
            setError(body.recordingsError ?? null);
            if (key === todayKey) {
                const now = new Date();
                setNowMinutes(Math.floor((now.getTime() - dayStartOf(key).getTime()) / 60_000));
            }
            return body.recordings ?? [];
        } catch (e) {
            toast.error(`Daftar rekaman gagal dimuat: ${e instanceof Error ? e.message : "kesalahan"}`);
            return null;
        } finally {
            setLoading(false);
        }
    }

    async function changeDate(key: string) {
        if (!key || key > todayKey) return;
        setDateKey(key);
        setRecordings([]);
        setError(null);
        await fetchRecordings(key);
    }

    /** Putar mulai menit `fromMin` (sejak 00:00) selama SPAN menit, dimulai dari rekaman pertama di rentang itu. */
    async function playFrom(fromMin: number) {
        // Hari ini: muat ulang dulu, karena rekaman terus bertambah sejak halaman dibuka.
        const segments = isToday ? ((await fetchRecordings(dateKey)) ?? recordings) : recordings;
        const toMin = Math.min(DAY, fromMin + SPAN);
        const overlap = segments.filter((s) => s.endMin > fromMin && s.startMin < toMin).sort((a, b) => a.startMin - b.startMin);
        if (overlap.length === 0) {
            toast.info(`Tidak ada rekaman pada ${hhmm(fromMin)}–${hhmm(toMin)}. Pilih bagian timeline yang berwarna biru.`);
            return;
        }
        const beginMin = Math.max(fromMin, overlap[0].startMin);
        const minute = 60_000;
        play({
            start: new Date(dayStart.getTime() + beginMin * minute),
            // Batas akhir hari: 23:59:59 agar tetap di tanggal yang sama (syarat player).
            end: new Date(dayStart.getTime() + toMin * minute - (toMin === DAY ? 1000 : 0)),
        });
    }

    function onTimelineClick(e: MouseEvent<HTMLDivElement>) {
        const rect = e.currentTarget.getBoundingClientRect();
        const minute = Math.round(((e.clientX - rect.left) / rect.width) * DAY);
        const from = Math.min(DAY - 1, Math.max(0, minute));
        setSelectedStart(Math.min(from, DAY - SPAN));
        void playFrom(from);
    }

    const rangeOptions = Array.from({ length: 24 }, (_, h) => ({
        value: String(h * 60),
        label: `${pad(h)}:00 – ${pad(h + 1)}:00`,
    }));
    // Nilai dari klik timeline bisa bukan jam bulat; tampilkan apa adanya.
    const selectedLabel = `${hhmm(selectedStart)} – ${hhmm(Math.min(DAY, selectedStart + SPAN))}`;

    const range = (
        <Select value={String(selectedStart)} onValueChange={(v) => setSelectedStart(Number(v))}>
            <SelectTrigger
                aria-label="Rentang jam"
                className="h-[34px] rounded-lg border bg-white px-2.5 font-mono text-[12.5px] font-medium shadow-none lg:text-[13px]"
            >
                <SelectValue>{selectedLabel}</SelectValue>
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
    const playButton = (
        <Button
            onClick={() => void playFrom(selectedStart)}
            disabled={loading}
            className="h-[34px] rounded-lg px-3.5 text-[13px] font-semibold max-lg:flex-1"
        >
            Putar rekaman
        </Button>
    );

    const note = error ? RECORDINGS_NOTE[error] : null;

    return (
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:gap-3.5 lg:px-5 lg:pt-[18px] lg:pb-5">
            <header className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold lg:text-[15px]">Rekaman MicroSD</h2>
                <div className="flex items-center gap-2">
                    {/* Input tanggal native tak terlihat di atas chip: klik chip membuka pemilih tanggal. */}
                    <label className="relative flex cursor-pointer items-center gap-1.5 rounded-lg border bg-white py-[5px] pr-2 pl-2 text-[12.5px] font-semibold hover:bg-muted lg:py-[7px] lg:pl-2.5 lg:text-[13px]">
                        <CalendarDays className="size-3.5 lg:size-[15px]" />
                        <span className="lg:hidden">{formatDayMonth(dayStart)}</span>
                        <span className="hidden lg:inline">{formatDateChip(dayStart)}</span>
                        <input
                            type="date"
                            aria-label="Tanggal rekaman"
                            value={dateKey}
                            max={todayKey}
                            onChange={(e) => void changeDate(e.target.value)}
                            onClick={(e) => e.currentTarget.showPicker?.()}
                            className="absolute inset-0 cursor-pointer opacity-0"
                        />
                    </label>
                    <span className="hidden items-center gap-2 lg:flex">
                        {range}
                        {playButton}
                    </span>
                </div>
            </header>

            <Timeline
                recordings={recordings}
                nowMinutes={isToday ? nowMinutes : null}
                selectedStart={selectedStart}
                loading={loading}
                onClick={onTimelineClick}
            />

            <div className="flex gap-2 lg:hidden">
                {range}
                {playButton}
            </div>

            <p className={note ? "text-xs font-medium text-status-warning" : "text-xs font-medium text-subtle"}>
                {note ??
                    (loading
                        ? "Memuat daftar rekaman…"
                        : recordings.length === 0
                          ? "Tidak ada rekaman pada tanggal ini. Kamera baterai biasanya hanya merekam saat ada gerakan."
                          : "Biru: ada rekaman. Klik bagian biru pada timeline untuk langsung memutar dari jam itu.")}
            </p>
        </section>
    );
}

function Timeline({
    recordings,
    nowMinutes,
    selectedStart,
    loading,
    onClick,
}: {
    recordings: RecordingSegment[];
    /** null = bukan hari ini (garis "sekarang" tidak ditampilkan) */
    nowMinutes: number | null;
    selectedStart: number;
    loading: boolean;
    onClick: (e: MouseEvent<HTMLDivElement>) => void;
}) {
    const labels = Array.from({ length: 9 }, (_, i) => i * 3);

    return (
        <div className="relative h-[46px] lg:h-[58px]">
            <div
                onClick={onClick}
                title="Klik untuk memutar dari jam ini"
                aria-label="Timeline rekaman 24 jam"
                className="absolute inset-x-0 top-1 h-5 cursor-pointer rounded bg-track lg:top-2 lg:h-6"
            >
                {recordings.map((seg) => (
                    <span
                        key={seg.startMin}
                        className="absolute inset-y-0 min-w-[2px] rounded-[3px] bg-primary/80"
                        style={{ left: pct(seg.startMin), width: pct(seg.endMin - seg.startMin) }}
                    />
                ))}
                {loading && <span className="absolute inset-0 animate-pulse rounded bg-white/50" />}
            </div>
            <span
                className="pointer-events-none absolute top-px h-[26px] rounded border-2 border-foreground lg:top-1 lg:h-8"
                style={{ left: pct(selectedStart), width: pct(SPAN) }}
            />
            {nowMinutes !== null && (
                <span
                    className="pointer-events-none absolute top-0.5 hidden h-9 w-0.5 bg-alert-badge lg:block"
                    style={{ left: pct(nowMinutes) }}
                />
            )}
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
