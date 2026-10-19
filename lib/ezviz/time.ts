// EZVIZ memakai string waktu "yyyy-MM-dd HH:mm:ss" tanpa zona waktu.
// ASUMSI (belum terverifikasi dengan kamera asli, lihat docs/ezviz-api-notes.md §9):
// string tersebut adalah waktu WIB (UTC+7, tanpa DST). Jika ternyata berbeda,
// cukup ubah OFFSET_MINUTES di sini.

const OFFSET_MINUTES = 7 * 60;
const OFFSET_MS = OFFSET_MINUTES * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");

export function formatEzvizTime(date: Date): string {
    const t = new Date(date.getTime() + OFFSET_MS);
    return (
        `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ` +
        `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`
    );
}

/** Menerima "yyyy-MM-dd HH:mm:ss" maupun "yyyy-MM-ddTHH:mm:ss". */
export function parseEzvizTime(value: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
    if (!m) throw new Error(`Format waktu EZVIZ tidak dikenal: ${value}`);
    const [, y, mo, d, h, mi, s] = m.map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - OFFSET_MS);
}

/** Awal hari (00:00 WIB) yang memuat `date`. */
export function startOfDayWib(date: Date): Date {
    const t = new Date(date.getTime() + OFFSET_MS);
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - OFFSET_MS);
}

/** "yyyyMMddHHmmss" (WIB) untuk parameter begin/end URL ezopen `.rec`. */
export function formatEzopenTime(date: Date): string {
    return formatEzvizTime(date).replace(/\D/g, "");
}

/** "yyyy-MM-dd" (WIB) dari sebuah waktu; dipakai sebagai kunci tanggal di URL/API. */
export function wibDateKey(date: Date): string {
    return formatEzvizTime(date).slice(0, 10);
}

/** 00:00 WIB untuk kunci "yyyy-MM-dd"; null bila formatnya salah. */
export function parseWibDateKey(key: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const date = parseEzvizTime(`${key} 00:00:00`);
    return Number.isNaN(date.getTime()) || wibDateKey(date) !== key ? null : date;
}
