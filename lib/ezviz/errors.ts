// Hierarki error EZVIZ. Pesan error TIDAK boleh memuat appSecret/accessToken
// (client hanya menyertakan path dan kode, tidak pernah isi request).

export class EzvizError extends Error {
    constructor(
        message: string,
        readonly code: number | null = null,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = new.target.name;
    }
}

/** Kode 10002: accessToken tidak valid/kedaluwarsa → refresh lalu ulangi. */
export class TokenExpiredError extends EzvizError {}

/** 10005 / 10017 / 10030: kredensial salah atau dibekukan → butuh tindakan manusia. */
export class CredentialError extends EzvizError {}

/** 10007 (kuota panggilan) / 10029 (frekuensi) → berhenti sementara, backoff. */
export class RateLimitError extends EzvizError {
    constructor(
        message: string,
        code: number,
        readonly kind: "quota" | "frequency",
    ) {
        super(message, code);
    }
}

/** 20007 / 2003: perangkat offline (bukan kegagalan sistem). */
export class DeviceOfflineError extends EzvizError {}

/** 20002 / 20014 / 20018 / ...: perangkat tidak ada atau bukan milik akun ini. */
export class DeviceNotFoundError extends EzvizError {}

/** 60020 / 2030 / 20015: perangkat tidak mendukung fungsi ini. */
export class UnsupportedError extends EzvizError {}

/** Gangguan sementara: jaringan, timeout, 49999, perangkat tidak merespons. Boleh dicoba lagi. */
export class TransientError extends EzvizError {}

/** Akun tidak dapat dipakai (DISABLED / TOKEN_ERROR) — dilempar token manager, bukan oleh EZVIZ. */
export class AccountUnavailableError extends EzvizError {
    constructor(
        message: string,
        readonly reason: "DISABLED" | "TOKEN_ERROR" | "NOT_FOUND",
    ) {
        super(message);
    }
}

const CREDENTIAL = new Set([10005, 10017, 10030]);
const OFFLINE = new Set([20007, 2003]);
const NOT_FOUND = new Set([20002, 20014, 20018, 20032, 2007, 20301, 20302, 20303]);
const UNSUPPORTED = new Set([60020, 2030, 20015]);
const TRANSIENT = new Set([49999, 20006, 20008, 2009, 60017]);

export function classifyError(code: number, message: string, path: string): EzvizError {
    const text = `EZVIZ ${path}: ${message || "error"} (kode ${code})`;
    if (code === 10002) return new TokenExpiredError(text, code);
    if (CREDENTIAL.has(code)) return new CredentialError(text, code);
    if (code === 10007) return new RateLimitError(text, code, "quota");
    if (code === 10029) return new RateLimitError(text, code, "frequency");
    if (OFFLINE.has(code)) return new DeviceOfflineError(text, code);
    if (NOT_FOUND.has(code)) return new DeviceNotFoundError(text, code);
    if (UNSUPPORTED.has(code)) return new UnsupportedError(text, code);
    if (TRANSIENT.has(code)) return new TransientError(text, code);
    return new EzvizError(text, code);
}
