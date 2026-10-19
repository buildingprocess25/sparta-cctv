import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Memeriksa header `Authorization: Bearer <CRON_SECRET>` untuk endpoint cron.
 * Mengembalikan Response error bila ditolak, atau null bila boleh lanjut.
 * Tanpa CRON_SECRET terkonfigurasi, endpoint selalu ditolak (aman secara bawaan).
 */
export function checkCronAuth(request: Request, secret: string | undefined = process.env.CRON_SECRET): Response | null {
    if (!secret) {
        return Response.json({ error: "CRON_SECRET belum dikonfigurasi" }, { status: 503 });
    }
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    // Bandingkan hash agar panjang input tidak bocor lewat waktu eksekusi.
    if (!match || !timingSafeEqual(digest(match[1]), digest(secret))) {
        return Response.json({ error: "Tidak diizinkan" }, { status: 401 });
    }
    return null;
}
