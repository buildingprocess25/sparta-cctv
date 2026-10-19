import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { CryptoError, decryptSecret, encryptSecret, maskSecret, parseKey } from "./crypto";

const key = randomBytes(32);
const otherKey = randomBytes(32);

describe("crypto", () => {
    it("enkripsi lalu dekripsi mengembalikan nilai asli", () => {
        const payload = encryptSecret("rahasia-123", { key });
        assert.ok(payload.startsWith("v1:"));
        assert.equal(decryptSecret(payload, { key }), "rahasia-123");
    });

    it("menangani karakter non-ASCII dan string kosong", () => {
        assert.equal(decryptSecret(encryptSecret("pässwörd—密码", { key }), { key }), "pässwörd—密码");
        assert.equal(decryptSecret(encryptSecret("", { key }), { key }), "");
    });

    it("IV acak: nilai yang sama menghasilkan ciphertext berbeda", () => {
        assert.notEqual(encryptSecret("sama", { key }), encryptSecret("sama", { key }));
    });

    it("tidak memuat plaintext di dalam payload", () => {
        assert.ok(!encryptSecret("super-secret-value", { key }).includes("super-secret-value"));
    });

    it("menolak key yang salah", () => {
        const payload = encryptSecret("x", { key });
        assert.throws(() => decryptSecret(payload, { key: otherKey }), CryptoError);
    });

    it("menolak data yang diubah", () => {
        const [v, iv, tag, data] = encryptSecret("abcdef", { key }).split(":");
        const tampered = Buffer.from(data, "base64");
        tampered[0] ^= 0xff;
        assert.throws(
            () => decryptSecret([v, iv, tag, tampered.toString("base64")].join(":"), { key }),
            CryptoError,
        );
    });

    it("AAD mengikat ciphertext ke konteksnya", () => {
        const payload = encryptSecret("token", { key, aad: "akun-1:accessToken" });
        assert.equal(decryptSecret(payload, { key, aad: "akun-1:accessToken" }), "token");
        assert.throws(() => decryptSecret(payload, { key, aad: "akun-2:accessToken" }), CryptoError);
        assert.throws(() => decryptSecret(payload, { key }), CryptoError);
    });

    it("menolak format dan versi yang tidak dikenal", () => {
        assert.throws(() => decryptSecret("bukan-ciphertext", { key }), CryptoError);
        const payload = encryptSecret("x", { key }).replace(/^v1/, "v9");
        assert.throws(() => decryptSecret(payload, { key }), /Versi enkripsi/);
    });

    it("parseKey memvalidasi panjang key", () => {
        assert.throws(() => parseKey(undefined), CryptoError);
        assert.throws(() => parseKey(Buffer.from("pendek").toString("base64")), CryptoError);
        assert.equal(parseKey(key.toString("base64")).length, 32);
    });

    it("maskSecret hanya menampilkan 4 karakter terakhir", () => {
        assert.equal(maskSecret("abcdef123456"), "••••••••3456");
        assert.equal(maskSecret("abc"), "••••");
    });
});
