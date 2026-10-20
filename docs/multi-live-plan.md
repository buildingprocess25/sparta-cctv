# Rencana Implementasi: Multi-Live per Kontraktor

Status (20 Okt 2026): **Fase 1–6 selesai (kode); Fase 0 dan uji manual dengan kamera asli belum dijalankan.**
Bawaan `LIVE_MAX_SESSIONS_PER_ACCOUNT` sementara **2** (pilihan konservatif) sampai Fase 0 membuktikan 3 stream stabil.
Akun uji saat ini hanya punya 2 kamera, jadi uji 3 stream butuh kamera ketiga.

## 1. Tujuan dan keputusan

Semua kamera milik satu kontraktor bisa dilihat **live bersamaan** di satu halaman baru. Dashboard utama tidak berubah (tetap snapshot).

| Keputusan | Nilai |
|---|---|
| Cakupan grid | Per **kontraktor** (gabungan semua tokonya) |
| Jumlah live bersamaan | 1–3 kamera |
| Mode | Live sungguhan (EZUIKit/ezopen), bukan snapshot |
| Paket EZVIZ | Tetap **Free** (1 Mbps per akun), tidak akan di-upgrade |
| Dashboard utama | Tidak berubah, hanya ditambah tautan masuk |

Karena satu kontraktor = satu akun EZVIZ, ketiga stream berbagi bandwidth 1 Mbps yang sama. Seluruh desain di bawah dibangun di atas batasan ini.

## 2. Batasan dan risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| 3 sub-stream di 1 Mbps (~300–500 kbps/stream) bisa melebihi kuota | Patah-patah atau ditolak EZVIZ (perilakunya belum diketahui, lihat `ezviz-api-notes.md` §9 no. 3) | **Fase 0 (uji)** menentukan batas aman (2 atau 3); batas bisa diatur lewat env |
| Kuota data 4G di SIM kamera | Konsumsi N× lipat | Auto-stop 3 menit tetap berlaku, wajib `quality=2`, HD dimatikan di grid |
| Baterai kamera (EB8) | Live membangunkan kamera | Sama: auto-stop, tanpa auto-reconnect tanpa batas |
| CPU browser (decode WASM EZUIKit) | Tab berat di laptop/HP | Maksimal 3 tile live; kontrol berat (mic, rekam, zoom) tidak ada di grid |
| Banyak instance EZUIKit dalam satu halaman | Belum pernah diuji di proyek ini | Diuji di Fase 0 |
| Pengguna lain sedang membuka live di akun yang sama | Sebagian tile kena 409 | Tile menampilkan "Slot live akun penuh" + tombol coba lagi |

## 3. Fase 0: uji kelayakan (wajib, sebelum membangun UI)

Tujuannya membuktikan bahwa akun Free sanggup memutar 2–3 stream serentak.

1. Ubah sementara `findConflict` agar mengizinkan 3 sesi (lewat env, lihat §4.1). Jangan di-commit ke main.
2. Buka 2, lalu 3 tab `/kamera/[id]` untuk kamera berbeda di akun yang sama, semuanya SD (sub-stream).
3. Catat untuk masing-masing (2 dan 3 stream):
   - apakah semua stream tampil, dan berapa lama sampai frame pertama;
   - kode error EZVIZ bila ada (simpan dari log `[ezopen] error:`);
   - kelancaran video selama ±3 menit;
   - pemakaian CPU browser (Task Manager);
   - selisih `liveSeconds` di `EzvizUsageDaily`.
4. Uji juga 3 instance EZUIKit di **satu halaman** (halaman uji sementara yang merender 3 `EzopenPlayer`). Ini membuktikan instance tidak saling mengganggu (id DOM, audio, decoder).
5. Tulis hasilnya di `docs/ezviz-api-notes.md` (bagian baru "Multi-stream akun Free").

**Hasil yang menentukan:** nilai bawaan `LIVE_MAX_SESSIONS_PER_ACCOUNT` (2 atau 3). Jika 2 stream pun tidak stabil, hentikan rencana ini dan laporkan ke atasan.

## 4. Server

### 4.1 Pembatas live: dari "1 sesi" menjadi "maksimal N sesi per akun"

`lib/live-limiter.ts`:

- Ganti `findConflict` dengan fungsi murni:
  ```ts
  /** null = boleh; selain itu alasan penolakan. Sesi kamera yang sama tidak dihitung (dipakai ulang). */
  export function checkCapacity(
      sessions: LiveSessionLike[], cameraId: string, now: Date,
      opts: { max: number; quality: 1 | 2 },
  ): "full" | "hd_busy" | null
  ```
  - Hitung sesi aktif **kamera lain** pada akun; bila `>= max` → `"full"`.
  - HD (`quality=1`) hanya boleh bila tidak ada sesi aktif kamera lain → `"hd_busy"`. Ini sesuai catatan `ezviz-api-notes.md` §5: HD hanya saat akun tidak sedang dipakai.
- `max` dibaca dari env `LIVE_MAX_SESSIONS_PER_ACCOUNT` (bawaan dari hasil Fase 0, minimal 1). Cukup konstanta env, tidak perlu kolom di DB, karena paket tidak akan berubah.
- `LiveSession` perlu menyimpan kualitas agar sesi HD yang sedang berjalan ikut diperhitungkan: tambah kolom `quality Int @default(2)` (migrasi baru) dan isi di `POST`.
  - Aturan tambahan: bila ada sesi HD aktif di kamera lain → permintaan baru juga ditolak `"hd_busy"`.

Tes di `lib/live-limiter.test.ts`: batas N tercapai, kamera yang sama tidak dihitung, sesi kedaluwarsa/berakhir diabaikan, HD ditolak bila ada sesi lain, permintaan ditolak bila ada sesi HD lain.

### 4.2 `POST /api/cameras/[id]/live`: cek kapasitas secara atomik

Saat ini urutannya: cek (`findMany`) → panggil EZVIZ → tulis sesi. Grid memicu 3 POST hampir bersamaan, sehingga dua permintaan bisa lolos cek yang sama.

- Pindahkan "cek + buat sesi" ke dalam `prisma.$transaction` dengan kunci per akun:
  `SELECT pg_advisory_xact_lock(hashtext(${accountId}))`, lalu `findMany` → `checkCapacity` → `closeSessions` (kamera ini) → `create`.
- Sesi dibuat **sebelum** memanggil `getPlayerAccess` (masih status *pending* 60 dtk seperti sekarang). Bila panggilan EZVIZ gagal, sesi langsung ditutup.
- Pesan 409:
  - `full`: "Slot live akun kontraktor ini penuh (maks. N kamera). Tutup salah satu live."
  - `hd_busy`: "Kualitas HD hanya bisa dipakai saat tidak ada live lain di akun ini."
- Tambah `code: "full" | "hd_busy"` di body 409 agar klien bisa menampilkan pesan yang tepat.

`PATCH` dan `DELETE` tidak berubah: keduanya sudah bekerja per kamera/per sesi.

### 4.3 Data halaman

- `StoreView` (`lib/monitoring-core.ts`) tambah `contractorId: string`. Isi di `loadDbStores` (`s.contractorId`) dan `loadMockStores` (`mockAccountId(s.contractor)` atau indeks kontraktor).
- `lib/monitoring.ts`: fungsi baru
  ```ts
  getContractorLive(contractorId: string): Promise<{
      contractor: { id: string; name: string };
      account: StoreView["ezvizAccount"];
      cameras: (CameraView & { storeName: string; storeCode: string })[];
      maxLive: number;
  } | null>
  ```
  Dibangun dari `loadStores()` lalu difilter per kontraktor. Urutan kamera: toko (nama), lalu label.

## 5. Klien

### 5.1 Pecah `LivePlayer` menjadi hook + tampilan

`components/live/live-panel.tsx` saat ini mencampur logika sesi dengan UI kontrol. Pindahkan logika sesi ke `components/live/use-live-session.ts`:

```ts
useLiveSession({ cameraId, quality, playback?, autoStart }) => {
    state, error, ezopen, videoRef, controlsRef,
    start(), stop(), heartbeat(), // heartbeat sudah di-throttle 60 dtk
}
```

Isinya: `startStream`/`stopStream`/`attachHls`/`endSession`/cleanup saat unmount/heartbeat. Semua dipindah apa adanya.

`LivePlayer` di halaman detail lalu memakai hook ini. **Perilaku halaman detail tidak boleh berubah.** Refactor ini dikerjakan sebagai commit tersendiri dan dicek manual dulu sebelum lanjut.

Countdown auto-stop tetap di pemanggil: halaman detail punya countdown sendiri, grid punya satu countdown bersama.

### 5.2 Komponen grid

```
components/multi-live/
  multi-live-grid.tsx   // client: countdown bersama, start/stop semua, layout grid
  live-tile.tsx         // client: satu kamera, memakai useLiveSession
```

**`MultiLiveGrid`** (props: daftar kamera, `maxLive`):
- Menentukan kamera yang live dengan fungsi murni `pickLiveCameras(cameras, max)` (di `monitoring-core.ts`, dites): hanya ONLINE/UNSTABLE, urutan tampil, maksimal `max`. Kamera lain tampil sebagai tile snapshot.
- Saat halaman dibuka, live dimulai **bertahap** (jeda ±400 ms antar tile) agar EZVIZ dan browser tidak menerima lonjakan sekaligus.
- **Satu countdown 3 menit untuk semua tile.** Gerak pointer/klik di mana pun pada grid mereset countdown dan memicu `heartbeat()` setiap tile (sudah ter-throttle). Saat habis, semua tile berhenti. Overlay "Lanjutkan live semua" memulai ulang semuanya.
- Bar atas: nama kontraktor, "N/M kamera live", countdown, tombol **Jeda semua / Lanjutkan semua**, **Layar penuh** (grid, untuk monitor pajangan).
- Tata letak tile 16:9: 1 kamera → 1 kolom lebar penuh; 2 → 2 kolom; 3 → 3 kolom di `xl`, 2+1 di `md`; mobile selalu 1 kolom.

**`LiveTile`** (selalu `quality=2`):
- Tampil: video/EZUIKit, badge LIVE, label "CAM-01 · Area depan", nama toko, titik status.
- Kontrol minimal: **suara** (hanya satu tile boleh bersuara: menyalakan satu tile mematikan yang lain, state di grid), **layar penuh per tile**, tautan **"Buka detail"** ke `/kamera/[id]` (untuk PTZ, mic, rekam, HD, playback).
- Tidak ada di tile: mic, PTZ, rekam klip, zoom, HD.
- State khusus: memuat; error + "Coba lagi"; `409 full` → "Slot live akun penuh"; kamera offline/unknown → overlay sama seperti `CameraTile` dengan snapshot terakhir.
- Kamera di luar `maxLive` (kontraktor dengan >N kamera): tile snapshot dengan tombol "Live di sini". Tombol ini menghentikan tile live paling lama lalu memulai tile ini (*swap*), sehingga jumlah live tidak pernah melebihi N.

### 5.3 Halaman dan navigasi

- Rute baru: `app/(app)/kontraktor/[id]/live/page.tsx` (server component). Memanggil `getContractorLive`, `notFound()` bila tidak ada, lalu merender `MultiLiveGrid`.
  - Akun `TOKEN_ERROR`/`DISABLED`/tidak ada → banner, tanpa live (tile snapshot saja).
  - Mode mock → banner "Live tidak tersedia pada mode mock".
- ⚠️ Folder statis `kontraktor/` bisa menutupi `[section]` untuk `/kontraktor`. Periksa aturan prioritas rute di `node_modules/next/dist/docs/` (Next 16). Bila perlu, tambah `app/(app)/kontraktor/page.tsx` yang merender `ComingSoon` dan hapus `kontraktor` dari `SECTIONS`.
- Breadcrumb: Dashboard › {Kontraktor} › Live semua kamera.
- Tautan masuk:
  - `StoreCard` (header desktop dan mobile): tombol **"Live semua kamera"** → `/kontraktor/{contractorId}/live`. Hanya tampil bila kontraktor punya ≥1 kamera ONLINE/UNSTABLE.
  - Opsional: saat filter dashboard berisi tepat satu kontraktor, tombol yang sama juga muncul di header halaman.

### 5.4 Interaksi dengan halaman detail

- Halaman detail tetap meminta SD secara bawaan. Toggle HD yang ditolak `hd_busy` → toast pesan server, toggle kembali ke SD.
- Membuka detail kamera yang sedang live di grid (tab lain): `POST` menutup sesi lama kamera itu (`closeSessions`) dan membuat yang baru. Ini perilaku yang sudah ada; tile grid tetap memutar, tetapi sesi DB-nya dianggap berakhir. Ini dapat diterima, cukup dicatat.

## 6. Urutan pengerjaan

| # | Pekerjaan | Hasil yang bisa dicek |
|---|---|---|
| 0 | Uji kelayakan multi-stream (§3) | Catatan hasil uji + nilai `max` |
| 1 | Limiter N sesi + kolom `quality` + transaksi atomik (§4.1–4.2) | Tes unit lulus; 2 tab detail bisa live bersamaan, tab ke-(N+1) ditolak 409 `full` |
| 2 | Refactor `useLiveSession` (§5.1) | Halaman detail berperilaku sama persis (live, playback, HD, PTZ, mic, auto-stop) |
| 3 | `contractorId` di `StoreView` + `getContractorLive` + `pickLiveCameras` (§4.3) | Tes `monitoring-core` lulus |
| 4 | Halaman `/kontraktor/[id]/live` + `MultiLiveGrid` + `LiveTile` (§5.2–5.3) | 2–3 kamera live serentak, countdown bersama, jeda/lanjut semua |
| 5 | Tautan dari `StoreCard` + penanganan `hd_busy` di detail (§5.3–5.4) | Alur dari dashboard ke grid |
| 6 | Perbarui `ezviz-integration-plan.md` (pembatas kini N sesi) dan README | — |

Tiap nomor = satu commit (atau satu PR kecil).

## 7. Pengujian

- **Unit** (`npm test`): `checkCapacity`, `pickLiveCameras`, `liveSecondsOf` (tidak berubah).
- **Manual dengan kamera asli** (Toko Uji EZVIZ, 2 kamera):
  1. Buka grid → kedua tile live, `LiveSession` aktif = 2.
  2. Diamkan 3 menit → semua berhenti, semua sesi `endedAt` terisi, `liveSeconds` bertambah ±2×180.
  3. Gerakkan mouse → countdown reset, `expiresAt` sesi diperpanjang (PATCH).
  4. Tutup tab saat live → sesi ditutup (DELETE keepalive).
  5. Grid terbuka + buka detail kamera ke-3 di akun yang sama dengan `max=2` → 409 `full`.
  6. Toggle HD di detail saat grid terbuka → ditolak `hd_busy`.
  7. Suara: menyalakan tile B mematikan tile A.
  8. Layar penuh grid dan per tile; tampilan mobile 1 kolom.
- Pantau CPU browser dan kelancaran selama uji 2 dan 3.

## 8. Di luar cakupan

- Grid lintas kontraktor / pilih kamera bebas.
- Playback MicroSD multi-kamera (sinkron).
- Mic, PTZ, rekam klip di grid (tetap lewat halaman detail).
- Pembersih sesi kedaluwarsa via cron (sudah tercatat sebagai sisa Fase 6 di `ezviz-integration-plan.md`).
- Autentikasi/otorisasi halaman. Ini tetap prasyarat production yang sama dengan halaman lain: `accessToken` akun terkirim ke browser (lihat catatan keamanan di `live/route.ts`).
