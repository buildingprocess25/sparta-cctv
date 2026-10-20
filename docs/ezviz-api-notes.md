# Catatan API EZVIZ Open Platform (Fase 0)

Dibaca dari dokumentasi resmi (15 Okt 2026): <https://open.ys7.com/help/en/472> (aturan umum), `/473` (token), `/476` (query perangkat), `/475` (administrasi perangkat + capture), `/534` (alamat live/playback), `/2867` (rekaman lokal).
Halaman daftar kode error (`/488`) tidak termuat saat dibaca; kode error di bawah berasal dari tiap halaman endpoint.

Semua isi di bawah **bersumber dari dokumentasi**, kecuali yang ditandai ⚠️ (belum terjawab oleh dokumentasi, harus diuji dengan akun asli).

## 1. Aturan umum

- Semua endpoint: `POST`, `Content-Type: application/x-www-form-urlencoded`, parameter di body (termasuk `accessToken`).
- HTTP 200 berarti JSON valid; `code` ada di dalam JSON.
- Ada **dua bentuk respons**:
  - Umum: `{ "code": "200", "msg": "...", "data": ... }` (`code` bertipe string).
  - Rekaman lokal (v3): `{ "meta": { "code": 200, "message": "...", "moreInfo": null }, "data": [...] }` (`code` bertipe angka). Kode error v3 bisa muncul dengan HTTP 200 (mis. `2003` offline) atau HTTP 401 (`10002`).
- Kode umum:

| Kode | Arti | Penanganan |
|---|---|---|
| 200 | Sukses | — |
| 10001 | Parameter salah | Bug di klien; jangan di-retry |
| **10002** | accessToken tidak valid/kedaluwarsa | Refresh token sekali, ulangi request sekali |
| 10005 | appKey dibekukan (frozen) | Akun `TOKEN_ERROR` permanen; butuh tindakan manusia |
| 10007 | Jumlah panggilan mencapai batas | Hentikan panggilan akun ini; catat; coba lagi nanti |
| 10017 | appKey tidak ada | Kredensial salah → `TOKEN_ERROR` |
| 10029 | Frekuensi panggilan mencapai batas | Backoff + kurangi frekuensi |
| 10030 | appKey dan appSecret tidak cocok | Kredensial salah → `TOKEN_ERROR` |
| 20002 / 20014 | Perangkat tidak ada / serial ilegal | Serial salah di sistem |
| 20007 | Perangkat offline | Status `OFFLINE`, bukan error sistem |
| 20008 / 2009 | Timeout respons perangkat | Retry terbatas |
| 20018 | User tidak memiliki perangkat | Perangkat dihapus dari akun kontraktor → tandai bermasalah |
| 49999 | Data/pemanggilan API error | Retry terbatas |

- `accessToken` harus dijaga kerahasiaannya dan diminta lewat backend (sesuai dokumentasi).

## 2. Token — `https://open.ezvizlife.com/api/lapp/token/get`

- Parameter: `appKey`, `appSecret`.
- Respons `data`: `accessToken`, `expireTime` (**milidetik**, timestamp), `areaDomain` (domain API wilayah akun; token **hanya valid di wilayah itu**).
- Semua endpoint lain dipanggil ke `{areaDomain}/api/lapp/...`. Panggilan token sendiri memakai host global `open.ezvizlife.com`.
- Kode khusus token: 10001, 10005, 10017, 10030, 49999.
- ⚠️ Dokumentasi **tidak menyebut umur token** (angka 7 hari berasal dari Anda). Baca dari `expireTime`.
- ⚠️ Tidak disebut apakah meminta token baru membatalkan token lama. Konsekuensi: refresh hanya bila perlu dan dengan kunci per akun (sesuai rencana).
- Domain akun uji (konsol `isgpopen.ezviz.com`, region Indonesia): contoh dokumentasi memakai `isgpopen.ezvizlife.com`. ⚠️ Pastikan `areaDomain` aktual dari respons pertama.

## 3. Daftar & status perangkat

### 3.1 `device/list` — dipakai untuk cek status massal
- Parameter: `accessToken`, `pageStart` (mulai 0), `pageSize` (default 10, **maks 50**).
- Respons: `page{total,page,size}`, `data[]` dengan `deviceSerial`, `deviceName`, `deviceType`, **`status` (1 online, 0 offline)**, `isEncrypt`, `defence`, `deviceVersion`, `updateTime`.
- **Satu panggilan mengembalikan status seluruh perangkat satu akun** (maks 10 pada paket Free) → inti cek status 5 menit; biaya 1 panggilan per akun per siklus.

### 3.2 `device/info`
- Parameter: `deviceSerial`. Respons: `deviceName`, `model` (mis. `CS-C1-11WPFR`), `status`, `defence`, `isEncrypt`.
- Dipakai mengisi **model perangkat**. Catatan: tabel dokumentasi menulis `status` "0 online, 1 online" (salah ketik); gunakan semantik `device/list` (1 = online).

### 3.3 `camera/list` dan `device/camera/list`
- `camera/list`: semua kamera akun (paginasi, maks 50). `device/camera/list`: kanal satu perangkat (`deviceSerial`).
- Field: `deviceSerial`, `channelNo`, `channelName`, **`status` (0 offline, 1 online, -1 perangkat belum melapor)**, `isShared`, `picUrl` (gambar sampul; bila belum diatur pengguna → gambar bawaan, bukan tangkapan nyata), `isEncrypt`, `videoLevel`.
- `status = -1` → petakan ke `UNKNOWN`.

### 3.4 `device/status/get` — status MicroSD
- Parameter: `deviceSerial`, `channel` (opsional, default 1). Satu panggilan **per perangkat**.
- Field relevan: `diskNum` (jumlah SD terpasang; -1 tidak dilaporkan), `diskState` (string per-disk: `0` normal, `1` media salah, `2` belum diformat, `3` sedang format; `-1` tidak dilaporkan). Contoh `"0---------------"` = disk 1 normal.
- Petakan ke `SdCardStatus`: `diskNum = 0` → `NONE`; `0` → `OK`; `2` → `NOT_FORMATTED`; `1` → `UNREADABLE`; `3` → anggap `NOT_FORMATTED` sementara; `-1` → tidak diubah (pertahankan nilai terakhir).
- Field lain (baterai, PIR, privasi, cloud) tidak dipakai saat ini.
- Perangkat harus online; ⚠️ perilaku saat offline (`20007`/`2003`?) diuji nanti.

## 4. Snapshot — `device/capture`
- Parameter: `deviceSerial`, `channelNo` (wajib; IPC = 1), `quality` (0 smooth, 1 HD 720P, 2 4CIF, 3 1080P, 4 4MP; opsional).
- Respons: `data.picUrl` (URL gambar di `img.ys7.com`, sering `http`).
- Kode khusus: 20006, 20007 (offline), 20008 (timeout), 20032 (kanal tidak ada), 60017 (gagal menangkap), 60020 (tidak didukung).
- Implikasi:
  - Perintah dikirim ke perangkat → **memakai data 4G kamera** dan bisa lambat. Gunakan `quality` rendah (0 atau 1) untuk thumbnail.
  - `picUrl` kemungkinan sementara → **unduh dan simpan di server** (rencana §7 sudah demikian), jangan simpan URL-nya.
  - URL `http` diunduh server-ke-server; ke browser sajikan lewat route sendiri (HTTPS) agar tidak terkena mixed content.
  - ⚠️ Masa berlaku `picUrl` dan batas ukuran tidak disebut.
- Alternatif murah untuk daftar: `picUrl` dari `camera/list` (gambar sampul/bawaan; bukan tangkapan nyata) — tidak cocok sebagai snapshot terkini.

## 5. Live dan playback — `live/address/get`
- Parameter: `deviceSerial`, `channelNo` (default 1), **`protocol`** (1 ezopen, **2 hls**, 3 rtmp, 4 flv; default 1), `code` (sandi enkripsi video, untuk ezopen), **`expireTime`** (detik; hls/rtmp/flv: 30 detik–720 hari), **`type`** (1 preview, **2 playback rekaman lokal**, 3 playback cloud), **`quality`** (1 HD/bitrate utama, **2 lancar/sub-stream**; default 1), `startTime`/`stopTime` (`yyyy-MM-dd HH:mm:ss`, untuk `type` ≠ 1 dan `protocol` ≠ 1).
- Respons: `data.id` (id alamat), `data.url` (mis. `.../v3/openlive/<serial>_1_1.m3u8?expire=...`), `data.expireTime` (`yyyy-MM-dd HH:mm:ss`).
- Mengakhiri alamat: `live/address/disable` dengan `deviceSerial`, `channelNo`, `urlId` (= `data.id`).
- Keputusan desain dari sini:
  - Gunakan **HLS (`protocol=2`)** → bisa diputar di browser dengan hls.js, tanpa SDK khusus.
  - Set `expireTime = 180` agar sejalan dengan auto-stop 3 menit; panggil `disable` saat sesi ditutup.
  - Pakai **`quality=2` (sub-stream)** sebagai bawaan untuk menghemat bandwidth 1 Mbps; HD hanya bila diminta dan akun tidak sedang dipakai.
  - Playback rekaman MicroSD memakai endpoint yang sama dengan `type=2` + `startTime`/`stopTime` (mis. rentang 1 jam yang dipilih di UI), jadi tidak butuh endpoint terpisah.
  - Pembatas maks. N sesi aktif per akun (`LIVE_MAX_SESSIONS_PER_ACCOUNT`, bawaan 2) berlaku untuk live maupun playback; HD hanya bila tidak ada live lain di akun.
- ⚠️ Belum jelas: apakah video terenkripsi (`isEncrypt = 1`) bisa diputar via HLS tanpa kode. Syarat aman: nonaktifkan enkripsi video pada kamera yang dipasang, atau uji dengan perangkat asli.
- ⚠️ URL HLS berada di host EZVIZ; periksa apakah butuh header/CORS khusus untuk diputar dari domain kita.

## 6. Daftar rekaman MicroSD — `{areaDomain}/api/v3/das/device/local/video/query`
- Dokumentasi menyebut **GET**; `accessToken` dan `deviceSerial` (serta `channelNo` opsional) di **header**, filter di query: `recordType` (1 terjadwal, 2 event, 3 mobil, 4 manusia; default semua), `startTime`, `endTime` (`yyyy-MM-dd HH:mm:ss`; default 00:00 hari ini sampai sekarang).
- Respons: `data[]` dengan `startTime`, `endTime` (format `2022-11-10T11:44:15`), `deviceSerial`, `cameraNo`, `type` (mis. `TIMING`), `size`.
- Kode (dalam `meta`/HTTP): `2003` perangkat offline, `2007` nomor perangkat salah, `2009` timeout, `2030`/`20015` tidak didukung, `10002` (HTTP 401) token kedaluwarsa.
- Implikasi: segmen asli menggantikan `deriveRecordings` di `lib/monitoring.ts`. ⚠️ Zona waktu string waktu tidak disebut (kemungkinan waktu lokal perangkat); verifikasi dengan kamera asli. Konversi ke menit-sejak-00:00 WIB untuk timeline.

## 6b. PTZ (pan/tilt) — `device/ptz/start` dan `device/ptz/stop`
- Parameter: `accessToken`, `deviceSerial`, `channelNo`, `direction` (0 atas, 1 bawah, 2 kiri, 3 kanan, 4–7 diagonal, 8/9 zoom optik masuk/keluar, 10/11 fokus), `speed` (0 lambat, 1 sedang, 2 cepat). `stop` tanpa `direction` = hentikan semua.
- Kamera terus bergerak sampai `stop` → klien wajib mengirim stop saat tombol dilepas (lihat `components/live/ptz-pad.tsx`).
- Kode: `60000` tidak mendukung PTZ, `60002`–`60005` batas putar atas/bawah/kiri/kanan (dipetakan ke `ptz_limit`, bukan kegagalan), `60006` operasi gagal (transient), `60020` perintah tidak didukung.
- ⚠️ Sumber: daftar arah/kecepatan dari halaman pihak ketiga EZVIZ-Open (`clawhub.ai/Ezviz-Open/ezviz-open-ptz-control`) dan kode 6000x dari ingatan dokumentasi; verifikasi dengan EB8 asli.
- EB8 tidak punya zoom optik → zoom di UI memakai zoom digital EZUIKit (`enableZoom`), bukan arah 8/9.

## 7. Penambahan perangkat (opsional, tidak dipakai di tahap awal)
- `device/add` (`deviceSerial` + `validateCode` 6 huruf kapital di badan kamera), `device/delete`, `device/name/update`.
- Kode: `20013` perangkat sudah ditambahkan akun lain, `20017` sudah ada di akun ini, `20010` kode verifikasi salah.
- Karena akun milik kontraktor, **sistem tidak menambah/menghapus perangkat di akun mereka**; kontraktor melakukannya sendiri. Sistem hanya membaca daftar dan mencocokkan serial.

## 8. Dampak pada rencana implementasi

| Rencana | Perubahan |
|---|---|
| §2 status verifikasi | Semua endpoint utama kini terdokumentasi (tabel di bawah) |
| §7 cek status | Pakai `device/list` (1 panggilan/akun/siklus). `device/status/get` (SD) per perangkat dijalankan lebih jarang (mis. tiap 30 menit) atau saat status berubah menjadi online, untuk menghemat kuota panggilan (10007/10029) |
| §7 snapshot | Gunakan `quality` rendah; jangan lebih sering dari kebutuhan karena memakai data 4G kamera; unduh gambar ke server |
| §7 live | HLS, `expireTime=180`, `quality=2`, panggil `live/address/disable` saat berhenti |
| §7 playback | `live/address/get` `type=2` + rentang waktu; daftar segmen dari `v3/das/device/local/video/query` |
| §5 klien | Mendukung dua bentuk respons dan satu endpoint GET dengan header; token diminta ke host global |
| Error handling | Pisahkan: 10002 (refresh), 10005/10017/10030 (`TOKEN_ERROR` permanen), 10007/10029 (batas, backoff), 20007 (`OFFLINE`), 20018 (perangkat hilang dari akun) |

Ringkasan status verifikasi:

| Kebutuhan | Endpoint | Status |
|---|---|---|
| Token | `POST open.ezvizlife.com/api/lapp/token/get` | Terdokumentasi |
| Status perangkat massal | `{area}/api/lapp/device/list` | Terdokumentasi |
| Info/model | `{area}/api/lapp/device/info` | Terdokumentasi |
| Status MicroSD | `{area}/api/lapp/device/status/get` | Terdokumentasi |
| Snapshot | `{area}/api/lapp/device/capture` | Terdokumentasi |
| Live HLS | `{area}/api/lapp/live/address/get` (+ `/disable`) | Terdokumentasi |
| Playback | `live/address/get` `type=2` | Terdokumentasi |
| Daftar rekaman | `{area}/api/v3/das/device/local/video/query` | Terdokumentasi |

## 9. Hal yang masih harus diuji dengan akun asli (⚠️)

1. Umur token dan perilaku refresh (apakah token lama langsung tidak berlaku).
2. `areaDomain` yang dikembalikan untuk akun region Indonesia.
3. Kuota panggilan harian paket Free (10007) dan batas frekuensi (10029); apa yang terjadi saat bandwidth/kuota terlampaui.
4. Masa berlaku dan ukuran `picUrl` hasil capture; dampak data 4G.
5. Zona waktu pada hasil `local/video/query`.
6. Pemutaran HLS: CORS/header, dan perilaku pada perangkat dengan enkripsi video aktif.
7. Respons `device/status/get` dan `capture` saat perangkat offline.
8. Isi halaman daftar kode error resmi (`/help/en/488`) — buka manual di browser bila perlu.
