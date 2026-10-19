import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Enkripsi nilai rahasia (appSecret, accessToken EZVIZ) sebelum masuk database.
// AES-256-GCM dengan IV acak per nilai. Format: "v1:<iv>:<tag>:<ciphertext>" (base64).
// Prefiks versi memungkinkan rotasi key di kemudian hari (re-enkripsi ke "v2:").

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENV_NAME = "EZVIZ_ENCRYPTION_KEY";

export class CryptoError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CryptoError";
    }
}

export function parseKey(value: string | undefined): Buffer {
    if (!value) {
        throw new CryptoError(`${ENV_NAME} belum diisi`);
    }
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) {
        throw new CryptoError(
            `${ENV_NAME} harus 32 byte base64 (hasil: openssl rand -base64 32)`,
        );
    }
    return key;
}

function resolveKey(key?: Buffer): Buffer {
    return key ?? parseKey(process.env[ENV_NAME]);
}

/**
 * @param aad data tambahan yang ikut diautentikasi (mis. `${accountId}:appSecret`)
 *            sehingga ciphertext tidak bisa dipindah ke baris/kolom lain.
 */
export function encryptSecret(plain: string, options: { key?: Buffer; aad?: string } = {}): string {
    const key = resolveKey(options.key);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    if (options.aad) cipher.setAAD(Buffer.from(options.aad, "utf8"));
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(payload: string, options: { key?: Buffer; aad?: string } = {}): string {
    const parts = payload.split(":");
    if (parts.length !== 4) throw new CryptoError("Format ciphertext tidak valid");
    const [version, ivB64, tagB64, dataB64] = parts;
    if (version !== VERSION) throw new CryptoError(`Versi enkripsi tidak didukung: ${version}`);

    const key = resolveKey(options.key);
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
        if (options.aad) decipher.setAAD(Buffer.from(options.aad, "utf8"));
        decipher.setAuthTag(Buffer.from(tagB64, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
    } catch {
        // Pesan sengaja generik: tidak membocorkan penyebab (key salah / data diubah).
        throw new CryptoError("Gagal mendekripsi: key salah atau data rusak");
    }
}

/** Untuk tampilan UI: hanya 4 karakter terakhir yang terlihat. */
export function maskSecret(value: string): string {
    if (value.length <= 4) return "••••";
    return `••••••••${value.slice(-4)}`;
}
