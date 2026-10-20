# SPARTA CCTV Monitoring

Sistem monitoring CCTV kontraktor pada pembangunan toko Alfamart baru (bagian dari ekosistem SPARTA).
Desain: [Figma — tab "v2 — Revisi"](https://www.figma.com/design/1QH1kWIUu0I2UEezMVOuGS/Sparta-CCTV-Monitoring).

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (`radix-vega`) · Prisma 7 · PostgreSQL

## Menjalankan

```bash
npm install
cp .env.example .env      # isi DATABASE_URL / DIRECT_URL jika memakai database
npm run dev               # http://localhost:3002
```

Secara bawaan `CAMERA_DATA_SOURCE=mock`: dashboard memakai data contoh dari `lib/seed-data.ts`, tanpa database.
Untuk memakai PostgreSQL:

```bash
# set CAMERA_DATA_SOURCE=db di .env
npx prisma migrate dev --name init
npm run db:seed
```

## Pekerjaan terjadwal (VPS)

Mode `CAMERA_DATA_SOURCE=ezviz` membutuhkan dua pemicu cron. Endpoint menolak request tanpa `CRON_SECRET`.

```
*/5 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ezviz-poll-status
15 3 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ezviz-refresh-tokens
```

- `ezviz-poll-status`: cek status semua kamera, catat perubahan (`CameraEvent`), hitung putus/uptime, ambil MicroSD & snapshot sesuai jeda.
- `ezviz-refresh-tokens`: perbarui token yang habis dalam 24 jam dan coba ulang akun `TOKEN_ERROR` tiap ≥ 6 jam.

## Struktur

- `app/(app)/` — Dashboard (`/`), Live View (`/kamera/[id]`), live semua kamera kontraktor (`/kontraktor/[id]/live`), admin akun EZVIZ (`/pengaturan/ezviz`, butuh `ADMIN_UI_ENABLED=true`); halaman lain masih placeholder
- `lib/monitoring.ts` — akses data dashboard/detail kamera (mock atau database)
- `lib/seed-data.ts` — data contoh: 8 kontraktor, 19 toko, 46 kamera
- `lib/poller/` — poller status kamera, aturan uptime/putus, penyimpanan snapshot
- `lib/ezviz/`, `lib/cameras/` — klien EZVIZ, token manager, gateway (mock / ezviz)
- `docs/` — rencana integrasi dan catatan API EZVIZ
- `prisma/` — skema dan seed
- Token desain dari Figma ada di `app/globals.css`

## Belum dikerjakan

Login/SSO, live stream dan playback MicroSD sungguhan, uji dengan akun/kamera asli,
halaman Semua Kamera / Perlu Ditindak / Toko / Kontraktor / Pengaturan, CI/CD. Rencana lengkap: `docs/ezviz-integration-plan.md`.
