# Rencana Implementasi Integrasi EZVIZ

Status (19 Okt 2026): **Fase 0–5 selesai; Fase 6 sebagian** (live HLS via proxy, pembatas 1 sesi/akun, heartbeat PATCH, pencatatan `liveSeconds`/`snapshotCalls`, snapshot manual 30 dtk; belum: pembersih sesi kedaluwarsa di cron) (dokumentasi API, skema + enkripsi, klien + token manager, gateway + status UNKNOWN,
poller + cron, halaman admin akun). Sisa Fase 6–9 ( playback, uji akun asli, hardening).

Diuji end-to-end dengan database PostgreSQL sungguhan (cluster sementara: 3 migrasi diterapkan tanpa drift, seed, poller via
endpoint cron, halaman admin) dan server EZVIZ palsu. **Belum** diuji dengan akun/kamera EZVIZ asli.

## 1. Konteks dan batasan

| Fakta | Dampak |
|---|---|
| Tiap kontraktor membuat akun EZVIZ Open Platform sendiri; HO meminta appKey/appSecret dari mereka | Kredensial banyak dan milik pihak ketiga → disimpan di database, terenkripsi, bukan di `.env` |
| Satu akun = satu kontraktor (kasus >10 device dianggap edge case) | Relasi 1 kontraktor : 1 akun. Tabel akun tetap terpisah agar mudah dilonggarkan |
| Akun memakai paket **Free Trial**: 10 device, bandwidth 1 Mbps | Cap 10 device ditegakkan di sistem; live stream dibatasi 1 sesi aktif per akun |
| `accessToken` kedaluwarsa berkala (disebut 7 hari) | Pembaruan otomatis dari appKey/appSecret; umur dibaca dari `expireTime` respons, tidak di-hardcode |
| Deploy di VPS kantor | Cron dengan `crontab` + `CRON_SECRET`; wajib HTTPS agar stream bisa diputar di browser |
| Login ditunda | Halaman admin akun EZVIZ belum bisa dibatasi per role → harus diamankan sebelum production (lihat §9) |

Region akun uji: Indonesia (konsol `isgpopen.ezviz.com`). `areaDomain` per akun diambil dari respons token.

## 2. Status verifikasi API

| Kebutuhan | Endpoint | Status |
|---|---|---|
| Access token | `POST /api/lapp/token/get` (appKey, appSecret → accessToken, expireTime, areaDomain) | Terverifikasi di dokumentasi |
| Live address (HLS) + playback | `/api/lapp/live/address/get` (+ `/disable`) | Terverifikasi (Fase 0) |
| Daftar & status perangkat | `device/list`, `device/info`, `device/status/get` | Terverifikasi (Fase 0) |
| Snapshot (capture) | `device/capture` | Terverifikasi (Fase 0) |
| Daftar rekaman MicroSD | `/api/v3/das/device/local/video/query` | Terverifikasi (Fase 0) |

**Fase 0 selesai:** hasilnya ada di `docs/ezviz-api-notes.md` (endpoint, parameter, kode error, dan dampak ke rencana). Hal yang masih harus dipastikan dengan akun asli:
- apakah token baru membatalkan token lama (menentukan kebutuhan kunci saat refresh);
- domain API yang tepat untuk region Indonesia;
- kode error untuk token kedaluwarsa (`10002` terverifikasi), device offline, dan device tidak ditemukan;
- perilaku saat kuota/bandwidth paket Free terlampaui (diblokir atau ditagih).

## 3. Model data (perubahan Prisma)

```prisma
enum EzvizAccountStatus { ACTIVE TOKEN_ERROR DISABLED }

enum CameraStatus { ONLINE OFFLINE UNSTABLE UNKNOWN }   // UNKNOWN baru

model EzvizAccount {
  id                String             @id @default(cuid())
  contractorId      String             @unique
  contractor        Contractor         @relation(fields: [contractorId], references: [id])
  appKey            String
  appSecretEnc      String             // AES-256-GCM
  accessTokenEnc    String?
  tokenExpiresAt    DateTime?
  areaDomain        String?            // dari respons token
  deviceLimit       Int                @default(10)
  status            EzvizAccountStatus @default(ACTIVE)
  lastError         String?
  lastErrorAt       DateTime?
  lastTokenRefreshAt DateTime?
  usage             EzvizUsageDaily[]
  liveSessions      LiveSession[]
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
}

model EzvizUsageDaily {            // pemakaian harian per akun (pantau batas paket Free)
  id          String       @id @default(cuid())
  accountId   String
  account     EzvizAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  date        DateTime     @db.Date
  apiCalls    Int          @default(0)
  snapshotCalls Int        @default(0)
  liveSeconds Int          @default(0)
  @@unique([accountId, date])
}

model LiveSession {                // dasar pembatas 1 live aktif per akun
  id         String       @id @default(cuid())
  accountId  String
  account    EzvizAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  cameraId   String
  startedAt  DateTime     @default(now())
  expiresAt  DateTime     // startedAt + 3 menit
  endedAt    DateTime?
  @@index([accountId, endedAt])
}
```

Perubahan pada `Camera`: tambah `snapshotPath String?` dan `snapshotAt DateTime?`. Akun sebuah kamera diturunkan lewat `store → contractor → ezvizAccount` (tanpa kolom redundan). `deviceSerial` tetap unik.

Aturan cap: jumlah kamera dengan `deviceSerial` terisi di semua toko milik satu kontraktor tidak boleh melebihi `account.deviceLimit`; divalidasi di server action dan di constraint aplikasi.

## 4. Environment

Hapus `EZVIZ_APP_KEY` / `EZVIZ_APP_SECRET` dari `.env.example`. Daftar akhir:

```
DATABASE_URL, DIRECT_URL, DATABASE_POOL_MAX, ...
EZVIZ_ENCRYPTION_KEY=     # 32 byte base64 (openssl rand -base64 32); kehilangan key = semua secret tak terbaca
EZVIZ_API_BASE_URL=       # fallback sebelum areaDomain tersedia
CRON_SECRET=
SNAPSHOT_DIR=./storage/snapshots
CAMERA_DATA_SOURCE=mock   # mock | db | ezviz
```

## 5. Struktur kode

```
lib/crypto.ts                    enkripsi AES-256-GCM, format "v1:iv:tag:data", dukung rotasi key
lib/ezviz/types.ts               tipe respons
lib/ezviz/errors.ts              EzvizApiError, TokenExpiredError, DeviceOfflineError, RateLimitError
lib/ezviz/client.ts              HTTP bertipe; satu fungsi per endpoint; timeout + retry terbatas
lib/ezviz/token-manager.ts       getValidToken(accountId), refreshToken(accountId)
lib/ezviz/gateway.ts             antarmuka CameraGateway: listDevices, getStatus, snapshot, liveAddress, recordings
lib/ezviz/mock-gateway.ts        implementasi mock (sumber data sekarang)
lib/ezviz/ezviz-gateway.ts       implementasi asli, memakai token-manager + usage counter
lib/ezviz/live-limiter.ts        1 sesi live aktif per akun
lib/ezviz/poller.ts              siklus cek status → CameraEvent
app/api/cron/ezviz-refresh-tokens/route.ts
app/api/cron/ezviz-poll-status/route.ts
app/api/cameras/[id]/live/route.ts        POST mulai, DELETE hentikan
app/api/cameras/[id]/snapshot/route.ts    POST ambil baru, GET sajikan file
app/(app)/pengaturan/ezviz/...            halaman admin akun
```

`lib/monitoring.ts` tetap menjadi satu-satunya pintu data untuk UI; ia memanggil gateway/DB sesuai `CAMERA_DATA_SOURCE`. UI tidak berubah kecuali menangani status `UNKNOWN`.

## 6. Pengelola token

`getValidToken(accountId)`:
1. Baca akun. Jika `status = DISABLED` → lempar error.
2. Jika `tokenExpiresAt - 12 jam > sekarang` → dekripsi dan kembalikan token.
3. Jika tidak → `refreshToken`: ambil advisory lock Postgres per akun (`pg_advisory_xact_lock(hash(accountId))`), baca ulang (mungkin sudah diperbarui proses lain), panggil `token/get`, simpan token terenkripsi, `tokenExpiresAt = expireTime`, `areaDomain`, `lastTokenRefreshAt`, reset error.
4. Jika refresh gagal → `status = TOKEN_ERROR`, simpan `lastError`; semua kamera akun menjadi `UNKNOWN` pada siklus cek berikutnya.

Pemanggil API membungkus request dengan `withToken`: bila respons `10002` → refresh sekali lalu ulangi satu kali; gagal lagi → lempar error.

Cron harian `ezviz-refresh-tokens`: perbarui semua akun `ACTIVE` yang token-nya habis dalam < 24 jam. Akun `TOKEN_ERROR` dicoba ulang dengan jeda bertahap (mis. 1 jam, 6 jam, 24 jam) agar tidak membanjiri EZVIZ bila secret sudah diganti kontraktor.

## 7. Cek status, snapshot, live, playback

**Cek status (cron tiap 5 menit):** proses per akun secara berurutan (aman untuk rate limit), antar-akun paralel maksimal 3. Satu akun gagal tidak menghentikan akun lain. Hasil menulis `Camera.status`, `statusSince`, `lastCheckedAt`; baris `CameraEvent` dibuat hanya saat status berubah. `disconnectsToday` dan `uptime7d` dihitung dari `CameraEvent`. Aturan default `UNSTABLE`: online saat ini tetapi ≥ 3 putus hari ini (dapat diubah, disimpan sebagai konstanta konfigurasi). Akun `TOKEN_ERROR`/`DISABLED` → kamera `UNKNOWN`, bukan `OFFLINE`.

**Snapshot:** diambil oleh cron cek status (bukan saat halaman dibuka), disimpan di `SNAPSHOT_DIR`, disajikan lewat route sendiri. Dashboard menampilkan snapshot tersimpan; retensi: hanya yang terbaru per kamera. Tombol "Ambil snapshot" di Live View mengambil yang baru, dibatasi 1 per kamera per 30 detik.

**Live:** `POST /api/cameras/[id]/live`
1. Tolak bila kamera `OFFLINE`/`UNKNOWN`.
2. `live-limiter`: bila akun sudah punya `LiveSession` aktif (belum `endedAt`, belum lewat `expiresAt`) milik kamera lain → balas 409 "Kamera lain pada akun kontraktor ini sedang dibuka". Sesi untuk kamera yang sama dipakai ulang.
3. Minta live address ke EZVIZ, buat `LiveSession` (`expiresAt = +3 menit`), kembalikan hanya URL stream (tanpa token/secret).
4. Interaksi klien memperpanjang sesi (heartbeat); `DELETE` atau kedaluwarsa menutupnya. Pembersih sesi berjalan di cron status.
5. `liveSeconds` dicatat ke `EzvizUsageDaily`.

Pemutar di `LivePanel` diganti dari placeholder menjadi player. Wajib HTTPS di VPS.

**Temuan uji akun asli (19 Okt 2026), kamera EB8 4G baterai `CS-EB8-R100-1K3FL4GA`:** stream standar
EZVIZ tidak mengirim video — HLS membalas playlist berisi segmen placeholder `/ErrCode/6520_0.ts`
(sub-stream) atau `/ErrCode/9053_0.ts` (HD), FLV terbuka tetapi 0 byte selama 80 detik. Player resmi
EZUIKit (`ezuikit-js`, protokol `ezopen://`) **berhasil** menampilkan video. Karena itu bawaan sekarang
`LIVE_PROTOCOL=ezopen`. Konsekuensi: `accessToken` akun kontraktor dikirim ke browser (EZUIKit
membutuhkannya) → wajib auth/proxy sebelum production; perbaikan ideal: token sub-akun (RAM) per perangkat.

**Playback MicroSD:** daftar rekaman dari EZVIZ menggantikan `deriveRecordings` di `lib/monitoring.ts`; timeline dan "Putar rekaman" memakai segmen asli. Putar rekaman ikut dibatasi oleh pembatas live yang sama (bandwidth sama).

## 8. Halaman admin akun EZVIZ (`/pengaturan/ezviz`)

- Daftar kontraktor dengan: status akun, sisa umur token, `x/10` device, terakhir dicek, error terakhir.
- Form tambah/ubah akun: appKey, appSecret (field password; setelah disimpan hanya tampil tersamarkan; kosong berarti tidak diganti).
- Tombol **Uji koneksi**: ambil token dan daftar perangkat; tampilkan hasil tanpa membocorkan secret.
- **Sinkronkan perangkat**: bandingkan daftar serial di EZVIZ dengan kamera di sistem; tampilkan selisih.
- Form pemetaan kamera: serial perangkat, nama/area, toko; menolak bila melewati cap 10.
- Nonaktifkan/aktifkan akun.
- Alert baru di "Perlu ditindak": "Akun EZVIZ {kontraktor}: token gagal diperbarui".

## 9. Keamanan

- Secret dan token hanya dibaca di server; tidak pernah dikirim ke klien dan tidak masuk log (gunakan penyamaran di logger).
- Enkripsi AES-256-GCM dengan IV acak per nilai; key hanya di env VPS, tidak di repo.
- Endpoint cron wajib `Authorization: Bearer $CRON_SECRET`.
- **Halaman admin dan route live/snapshot tidak boleh dibuka tanpa auth di production.** Karena login ditunda, pilih salah satu sebelum rilis: (a) selesaikan login/SSO dulu, atau (b) batasi sementara lewat reverse proxy (basic auth/IP kantor). Fitur EZVIZ tidak boleh dirilis di jaringan terbuka tanpa salah satunya.
- Audit singkat: catat siapa/kapan akun dibuat, diubah, atau dinonaktifkan (tabel `AuditLog` sederhana, sekaligus dipakai nanti oleh modul auth).
- Rotasi `EZVIZ_ENCRYPTION_KEY`: format `v1:` memungkinkan skrip re-enkripsi ke `v2:`.

## 10. Operasional di VPS

```
*/5 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ezviz-poll-status
15 3 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ezviz-refresh-tokens
```

Reverse proxy (Nginx/Caddy) dengan HTTPS, persistent volume untuk `SNAPSHOT_DIR`, backup database harian, health check endpoint sederhana, dan log error ke file/stdout yang dikumpulkan.

## 11. Pengujian

- Server EZVIZ palsu (MSW/server lokal) untuk: token sukses, token kedaluwarsa (`10002`) dengan refresh lalu ulang, refresh gagal → `TOKEN_ERROR` → kamera `UNKNOWN`, device offline, rate limit.
- Tes unit: enkripsi (round trip, key salah, data rusak), pembatas live (dua sesi bersamaan), cap 10 device, aturan `UNSTABLE`, penghitungan `uptime7d`.
- Tes konkurensi refresh: dua `getValidToken` bersamaan hanya memicu satu panggilan `token/get`.
- Uji manual dengan akun asli `qbeegl` (region Indonesia): satu kamera, lalu verifikasi bentuk respons yang masih bertanda "?" di §2.

## 12. Tahapan dan kriteria selesai

| Fase | Isi | Selesai bila |
|---|---|---|
| 0 | Baca dokumentasi API resmi; tulis `docs/ezviz-api-notes.md` | Semua baris §2 terverifikasi atau ditandai belum bisa |
| 1 | Skema Prisma + migrasi, `lib/crypto.ts`, `.env.example` baru | Tes enkripsi lulus; migrasi jalan di DB lokal |
| 2 | `client.ts` + `token-manager.ts` + server palsu | Tes token (sukses, kedaluwarsa, gagal, konkurensi) lulus |
| 3 | `CameraGateway` + mock + ezviz gateway; `monitoring.ts` memakai gateway; status `UNKNOWN` di UI | Dashboard berjalan di mode `mock` dan `ezviz` (dengan server palsu) |
| 4 | Cron cek status, `CameraEvent`, uptime, snapshot | Perubahan status menghasilkan event; snapshot tampil di dashboard |
| 5 | Halaman admin akun + alert akun bermasalah | Akun bisa ditambah, diuji, dan dinonaktifkan; cap 10 tegak |
| 6 | Live + pembatas + penghitung pemakaian | Sesi kedua pada akun sama ditolak; sesi berhenti otomatis 3 menit |
| 7 | Playback MicroSD asli | Timeline memakai segmen asli |
| 8 | Uji dengan akun asli, perbaiki selisih respons | Satu kamera asli lolos seluruh alur |
| 9 | Hardening: auth/proxy, backup, monitoring, dokumentasi operasional | Daftar §9 dan §10 terpenuhi |

Fase 0–5 bisa dikerjakan tanpa kredensial asli. Fase 6–8 butuh akun dan kamera nyata.

## 13. Risiko dan hal terbuka

- Endpoint status/snapshot/playback belum diverifikasi; bentuknya bisa memaksa penyesuaian pada `gateway`.
- Perilaku kuota/bandwidth Free yang terlampaui belum diketahui.
- Kontraktor dapat mengganti secret atau menghapus device sepihak → ditangani sebagai `TOKEN_ERROR`/`UNKNOWN`, tetapi perlu SOP komunikasi dengan kontraktor.
- Player live di browser (format stream yang didukung) menentukan library yang dipakai; diputuskan di Fase 0/6.
- Panduan untuk kontraktor (cara membuat akun, menambah device, memberikan appKey/appSecret) ditunda atas permintaan.
