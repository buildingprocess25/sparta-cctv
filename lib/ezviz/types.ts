export type EzvizToken = {
    accessToken: string;
    /** waktu kedaluwarsa (dari expireTime milidetik pada respons) */
    expiresAt: Date;
    /** domain API wilayah akun; token hanya valid di wilayah ini */
    areaDomain: string;
};

export type EzvizDevice = {
    deviceSerial: string;
    deviceName: string;
    deviceType: string;
    /** 1 online, 0 offline, -1 belum melapor */
    status: number;
    isEncrypt: boolean;
    deviceVersion: string | null;
};

export type EzvizDeviceInfo = {
    deviceSerial: string;
    deviceName: string;
    model: string;
    status: number;
    isEncrypt: boolean;
};

export type EzvizDeviceStatus = {
    /** jumlah kartu SD terpasang; -1 = tidak dilaporkan */
    diskNum: number;
    /** string per-disk: 0 normal, 1 media salah, 2 belum diformat, 3 sedang format; -1 = tidak dilaporkan */
    diskState: string;
};

export type LiveProtocol = 1 | 2 | 3 | 4; // 1 ezopen, 2 hls, 3 rtmp, 4 flv
export type LiveAddressType = 1 | 2 | 3; // 1 preview, 2 rekaman lokal, 3 cloud

export type LiveAddressRequest = {
    deviceSerial: string;
    channelNo?: number;
    protocol?: LiveProtocol;
    /** detik; hls/rtmp/flv: 30 detik – 720 hari */
    expireTime?: number;
    type?: LiveAddressType;
    /** 1 = HD (bitrate utama), 2 = lancar (sub-stream) */
    quality?: 1 | 2;
    /** "yyyy-MM-dd HH:mm:ss" */
    startTime?: string;
    stopTime?: string;
};

export type LiveAddress = {
    id: string;
    url: string;
    /** "yyyy-MM-dd HH:mm:ss" sesuai respons EZVIZ */
    expireTime: string;
};

export type LocalRecordSegment = {
    /** ISO tanpa zona waktu, mis. "2022-11-10T11:44:15" (zona waktu belum terverifikasi) */
    startTime: string;
    endTime: string;
    deviceSerial: string;
    channelNo: string;
    type: string;
};
