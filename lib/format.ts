const TZ = "Asia/Jakarta";

export function formatTime(date: Date) {
    return new Intl.DateTimeFormat("id-ID", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    })
        .format(date)
        .replace(".", ":");
}

/** "15/10 14:28" — overlay waktu pada thumbnail kamera */
export function formatOsd(date: Date) {
    const d = new Intl.DateTimeFormat("id-ID", {
        timeZone: TZ,
        day: "2-digit",
        month: "2-digit",
    }).format(date);
    return `${d} ${formatTime(date)}`;
}

/** "Kamis, 15 Oktober 2026" */
export function formatLongDate(date: Date) {
    return new Intl.DateTimeFormat("id-ID", {
        timeZone: TZ,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(date);
}

/** "28 Nov 2026" */
export function formatShortDate(date: Date) {
    return new Intl.DateTimeFormat("id-ID", {
        timeZone: TZ,
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(date);
}

/** "1 j 27 m" */
export function formatDuration(from: Date, now = new Date()) {
    const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h} j ${m} m` : `${m} m`;
}

export function formatPercent(value: number) {
    return `${value.toFixed(1).replace(".", ",")}%`;
}

/** Sisa umur dari `now` sampai `until`, mis. "6 hari 4 jam", "3 jam"; "habis" bila sudah lewat. */
export function formatTimeLeft(until: Date, now = new Date()) {
    const ms = until.getTime() - now.getTime();
    if (ms <= 0) return "habis";
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return "kurang dari 1 jam";
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    if (days === 0) return `${hours} jam`;
    return rest ? `${days} hari ${rest} jam` : `${days} hari`;
}

/** "15 Okt 2026 14:30" */
export function formatDateTime(date: Date) {
    return `${formatShortDate(date)} ${formatTime(date)}`;
}

/** "Kam, 15 Okt 2026" */
export function formatDateChip(date: Date) {
    return new Intl.DateTimeFormat("id-ID", {
        timeZone: TZ,
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(date);
}

/** "15 Okt" */
export function formatDayMonth(date: Date) {
    return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "numeric", month: "short" }).format(date);
}

/** "Kamis, 15 Okt 2026" */
export function formatCompactDate(date: Date) {
    return new Intl.DateTimeFormat("id-ID", {
        timeZone: TZ,
        weekday: "long",
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(date);
}
