import type { SdStatusValue } from "@/lib/ezviz/mappers";

// Antarmuka tunggal ke sumber data kamera. Implementasi: MockGateway (data contoh)
// dan EzvizGateway (EZVIZ Open API). Kode lain (poller, route live, halaman detail)
// hanya bergantung pada antarmuka ini.

/** Rujukan ke satu kamera di akun EZVIZ kontraktornya. */
export type DeviceRef = {
    accountId: string | null;
    deviceSerial: string | null;
    channelNo: number;
};

export type ConnectionState = "ONLINE" | "OFFLINE" | "UNKNOWN";

export type DeviceCheck = {
    deviceSerial: string;
    connection: ConnectionState;
    /** tipe/model dari EZVIZ */
    deviceType: string;
    /** video terenkripsi: pemutaran HLS belum terverifikasi untuk kasus ini */
    encrypted: boolean;
};

export type RecordingRange = { start: Date; end: Date };

export type SnapshotImage = { bytes: Uint8Array; contentType: string };

export type StartLiveOptions = {
    /** umur alamat (detik); sejalan dengan auto-stop 3 menit */
    expireSeconds: number;
    /** 2 = sub-stream (hemat bandwidth, bawaan); 1 = HD */
    quality?: 1 | 2;
    /** bila diisi → putar rekaman MicroSD pada rentang ini, bukan live */
    playback?: RecordingRange;
};

export type LiveStream = {
    /** id alamat, dipakai untuk stopLive */
    id: string;
    /** URL HLS (.m3u8) */
    url: string;
    expiresAt: Date;
};

/**
 * Akses untuk player ezopen (EZUIKit) di browser. Dipakai karena perangkat baterai/4G hemat daya
 * (mis. EZVIZ EB8) tidak mengirim video lewat HLS/RTMP/FLV standar — server stream EZVIZ hanya
 * membalas segmen "/ErrCode/..." — sedangkan protokol ezopen dapat membangunkan perangkat.
 */
export type PlayerAccess = {
    /** ezopen://open.ezviz.com/<serial>/<channel>.live (atau .hd.live) */
    url: string;
    accessToken: string;
    /** domain API wilayah akun, untuk opsi env.domain EZUIKit */
    domain: string;
};

export type PtzMove = "up" | "down" | "left" | "right";

export type PtzCommand = { action: "start"; move: PtzMove } | { action: "stop" };

export interface CameraGateway {
    readonly kind: "mock" | "ezviz";

    /** Status koneksi seluruh perangkat satu akun — 1 panggilan untuk ≤ 50 perangkat. */
    checkAccountDevices(accountId: string): Promise<DeviceCheck[]>;

    /** Status MicroSD; null bila perangkat tidak melaporkan (pertahankan nilai terakhir). */
    getSdStatus(ref: DeviceRef): Promise<SdStatusValue | null>;

    captureSnapshot(ref: DeviceRef, options?: { quality?: 0 | 1 | 2 | 3 | 4 }): Promise<SnapshotImage>;

    startLive(ref: DeviceRef, options: StartLiveOptions): Promise<LiveStream>;
    stopLive(ref: DeviceRef, streamId: string): Promise<void>;

    /** Kredensial player ezopen; token ini SAMPAI ke browser (lihat catatan keamanan di route live). */
    getPlayerAccess(ref: DeviceRef, options?: { quality?: 1 | 2 }): Promise<PlayerAccess>;

    /** Gerak pan/tilt. "start" bergerak terus sampai "stop" atau batas putar (error ptz_limit). */
    ptz(ref: DeviceRef, command: PtzCommand): Promise<void>;

    /** Segmen rekaman MicroSD dalam rentang, terurut dan terpotong ke rentang. */
    listRecordings(ref: DeviceRef, range: RecordingRange): Promise<RecordingRange[]>;
}
