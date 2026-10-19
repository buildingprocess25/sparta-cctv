import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { decryptSecret } from "@/lib/crypto";
import { AdminService, describeError, diffDevices } from "./admin-service";
import { EzvizClient } from "./client";
import { CredentialError, DeviceNotFoundError, RateLimitError, TransientError } from "./errors";
import { MemoryAdminStore } from "./memory-admin-store";
import { FakeEzvizServer } from "./testing/fake-server";
import { TokenManager } from "./token-manager";

const key = randomBytes(32);
const server = new FakeEzvizServer();

let store: MemoryAdminStore;
let service: AdminService;
let seq: number;

before(async () => {
    await server.start();
});
after(() => server.stop());

beforeEach(() => {
    server.credentials.clear();
    server.credentials.set("key-1", "secret-1");
    server.validTokens.clear();
    server.overrides.clear();
    server.requests.length = 0;
    server.tokenCalls = 0;
    server.devices = [];
    seq = 0;

    store = new MemoryAdminStore();
    store.addContractor("k1", "PT Satu");
    store.addContractor("k2", "PT Dua");
    const client = new EzvizClient({ tokenBaseUrl: server.baseUrl, timeoutMs: 1000 });
    const tokens = new TokenManager({ store, client, key });
    service = new AdminService({ store, tokens, client, key, newId: () => `acc${++seq}` });
});

const device = (serial: string, status = 1) => ({ deviceSerial: serial, deviceName: `Cam ${serial}`, deviceType: "H8c", status, isEncrypt: 0 });

describe("saveAccount", () => {
    it("membuat akun baru dengan secret terenkripsi (terikat ke id akun)", async () => {
        const r = await service.saveAccount("k1", { appKey: " key-1 ", appSecret: "secret-1" });
        assert.deepEqual(r, { ok: true, accountId: "acc1", created: true, changed: true });
        const saved = store.accounts.get("acc1")!;
        assert.equal(saved.appKey, "key-1");
        assert.ok(!saved.appSecretEnc.includes("secret-1"));
        assert.equal(decryptSecret(saved.appSecretEnc, { key, aad: "acc1:appSecret" }), "secret-1");
        assert.equal(saved.status, "ACTIVE");
    });

    it("validasi: appKey wajib tanpa spasi, appSecret wajib untuk akun baru, kontraktor harus ada", async () => {
        assert.equal((await service.saveAccount("k1", { appKey: "", appSecret: "x" })).ok, false);
        assert.equal((await service.saveAccount("k1", { appKey: "ada spasi", appSecret: "x" })).ok, false);
        const noSecret = await service.saveAccount("k1", { appKey: "key-1" });
        assert.ok(!noSecret.ok && /appSecret wajib/.test(noSecret.error));
        const unknown = await service.saveAccount("tidak-ada", { appKey: "key-1", appSecret: "x" });
        assert.ok(!unknown.ok && /tidak ditemukan/.test(unknown.error));
    });

    it("ubah tanpa appSecret mempertahankan secret lama; appKey berubah membuang token", async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        await service.testConnection("k1"); // menghasilkan token
        const secretBefore = store.accounts.get("acc1")!.appSecretEnc;
        assert.ok(store.accounts.get("acc1")!.accessTokenEnc);

        const r = await service.saveAccount("k1", { appKey: "key-baru", appSecret: "" });
        assert.ok(r.ok && r.changed && !r.created);
        const saved = store.accounts.get("acc1")!;
        assert.equal(saved.appKey, "key-baru");
        assert.equal(saved.appSecretEnc, secretBefore);
        assert.equal(saved.accessTokenEnc, null);
        assert.equal(saved.tokenExpiresAt, null);
    });

    it("mengganti secret memulihkan akun TOKEN_ERROR, tetapi tidak mengaktifkan akun DISABLED", async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        await store.recordError("acc1", "salah", "TOKEN_ERROR");
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-baru" });
        assert.equal(store.accounts.get("acc1")!.status, "ACTIVE");
        assert.equal(store.accounts.get("acc1")!.lastError, null);
        assert.equal(decryptSecret(store.accounts.get("acc1")!.appSecretEnc, { key, aad: "acc1:appSecret" }), "secret-baru");

        await service.setAccountEnabled("k1", false);
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "lagi" });
        assert.equal(store.accounts.get("acc1")!.status, "DISABLED");
    });

    it("tanpa perubahan → changed false dan tidak ada audit baru", async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        const audits = store.audits.length;
        const r = await service.saveAccount("k1", { appKey: "key-1" });
        assert.ok(r.ok && !r.changed);
        assert.equal(store.audits.length, audits);
    });

    it("audit tidak pernah memuat secret", async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-rahasia" });
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-rahasia-2" });
        assert.ok(store.audits.length >= 2);
        assert.ok(!JSON.stringify(store.audits).includes("secret-rahasia"));
    });
});

describe("testConnection", () => {
    it("berhasil: jumlah perangkat, kedaluwarsa token, dan areaDomain", async () => {
        server.devices = [device("A1"), device("B2")];
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        const r = await service.testConnection("k1");
        assert.ok(r.ok);
        assert.equal(r.deviceCount, 2);
        assert.equal(r.overLimit, false);
        assert.equal(r.areaDomain, server.baseUrl);
        assert.ok(r.tokenExpiresAt.getTime() > Date.now());
        assert.ok(store.accounts.get("acc1")!.accessTokenEnc);
    });

    it("lebih dari batas device → overLimit", async () => {
        server.devices = Array.from({ length: 11 }, (_, i) => device(`D${i}`));
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        const r = await service.testConnection("k1");
        assert.ok(r.ok && r.overLimit && r.deviceCount === 11);
    });

    it("kredensial salah → pesan ramah tanpa secret; akun ditandai TOKEN_ERROR", async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-salah" });
        const r = await service.testConnection("k1");
        assert.ok(!r.ok);
        assert.match(r.error, /tidak cocok/);
        assert.ok(!r.error.includes("secret-salah"));
        assert.equal(store.accounts.get("acc1")!.status, "TOKEN_ERROR");
    });

    it("uji koneksi memulihkan akun TOKEN_ERROR setelah kredensial diperbaiki", async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-salah" });
        await service.testConnection("k1");
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        const r = await service.testConnection("k1");
        assert.ok(r.ok);
        assert.equal(store.accounts.get("acc1")!.status, "ACTIVE");
    });

    it("tanpa akun, atau akun dinonaktifkan → pesan jelas tanpa panggilan jaringan", async () => {
        const none = await service.testConnection("k1");
        assert.ok(!none.ok && /belum dibuat/.test(none.error));
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        await service.setAccountEnabled("k1", false);
        const off = await service.testConnection("k1");
        assert.ok(!off.ok && /dinonaktifkan/.test(off.error));
        assert.equal(server.tokenCalls, 0);
    });
});

describe("syncDevices", () => {
    beforeEach(async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        store.addCamera({ id: "c1", contractorId: "k1", label: "CAM-01", deviceSerial: "AAA111" });
        store.addCamera({ id: "c2", contractorId: "k1", label: "CAM-02", deviceSerial: "ZZZ999" });
        store.addCamera({ id: "c3", contractorId: "k1", label: "CAM-03", deviceSerial: null });
    });

    it("memilah: cocok, hanya di EZVIZ, hanya di sistem, belum dipetakan", async () => {
        server.devices = [device("aaa111", 1), device("NEW777", 0)];
        const r = await service.syncDevices("k1");
        assert.ok(r.ok);
        assert.equal(r.deviceCount, 2);
        assert.deepEqual(r.diff.matched.map((m) => [m.deviceSerial, m.label, m.online]), [["AAA111", "CAM-01", true]]);
        assert.deepEqual(r.diff.onlyInEzviz.map((d) => d.deviceSerial), ["NEW777"]);
        assert.deepEqual(r.diff.onlyInSystem.map((c) => [c.label, c.deviceSerial]), [["CAM-02", "ZZZ999"]]);
        assert.equal(r.diff.unmappedCameras, 1);
    });

    it("akun belum ada, atau EZVIZ menolak → pesan ramah", async () => {
        const none = await service.syncDevices("k2");
        assert.ok(!none.ok && /belum dibuat/.test(none.error));

        server.overrides.set("/api/lapp/device/list", () => ({ body: { code: "10029", msg: "frequency" } }));
        const limited = await service.syncDevices("k1");
        assert.ok(!limited.ok && /Batas panggilan/.test(limited.error));
    });
});

describe("setAccountEnabled", () => {
    it("nonaktifkan lalu aktifkan kembali, tercatat di audit", async () => {
        await service.saveAccount("k1", { appKey: "key-1", appSecret: "secret-1" });
        assert.ok((await service.setAccountEnabled("k1", false)).ok);
        assert.equal(store.accounts.get("acc1")!.status, "DISABLED");
        assert.ok((await service.setAccountEnabled("k1", true)).ok);
        assert.equal(store.accounts.get("acc1")!.status, "ACTIVE");
        assert.deepEqual(store.audits.slice(-2).map((a) => a.action), ["ezviz.account.disable", "ezviz.account.enable"]);
    });

    it("tanpa akun → error", async () => {
        assert.equal((await service.setAccountEnabled("k1", false)).ok, false);
    });
});

describe("mapCameraSerial", () => {
    beforeEach(() => {
        for (let i = 1; i <= 12; i++) store.addCamera({ id: `c${i}`, contractorId: "k1", label: `CAM-${i}`, storeName: i <= 6 ? "Toko A" : "Toko B" });
        store.addCamera({ id: "x1", contractorId: "k2", label: "CAM-X", storeName: "Toko Z" });
    });

    it("menormalkan serial (trim + huruf besar) dan menyimpannya", async () => {
        const r = await service.mapCameraSerial("c1", "  bd7712045 ");
        assert.ok(r.ok && r.serial === "BD7712045" && r.changed);
        assert.equal(store.cameras.get("c1")!.deviceSerial, "BD7712045");
        assert.equal(store.audits.at(-1)!.action, "camera.serial.set");
    });

    it("menolak serial tidak valid dan kamera yang tidak ada", async () => {
        for (const bad of ["abc", "ada spasi di sini", "bd-7712045", "A".repeat(21)]) {
            assert.equal((await service.mapCameraSerial("c1", bad)).ok, false, bad);
        }
        assert.equal((await service.mapCameraSerial("tidak-ada", "BD7712045")).ok, false);
    });

    it("menolak serial yang sudah dipakai kamera lain", async () => {
        await service.mapCameraSerial("c1", "BD7712045");
        const r = await service.mapCameraSerial("c2", "bd7712045");
        assert.ok(!r.ok && /sudah dipakai kamera CAM-1 di Toko A/.test(r.error));
        assert.equal(store.cameras.get("c2")!.deviceSerial, null);
    });

    it("batas 10 perangkat per akun (lintas toko); perangkat ke-11 ditolak", async () => {
        for (let i = 1; i <= 10; i++) assert.ok((await service.mapCameraSerial(`c${i}`, `SERIAL${String(i).padStart(2, "0")}`)).ok);
        const r = await service.mapCameraSerial("c11", "SERIAL11");
        assert.ok(!r.ok && /Batas 10 perangkat/.test(r.error));
        assert.equal(await store.countMappedCameras("k1"), 10);
    });

    it("mengganti serial pada kamera terpetakan tetap boleh saat penuh; melepas membebaskan slot", async () => {
        for (let i = 1; i <= 10; i++) await service.mapCameraSerial(`c${i}`, `SERIAL${String(i).padStart(2, "0")}`);
        assert.ok((await service.mapCameraSerial("c1", "GANTI001")).ok);
        assert.ok((await service.mapCameraSerial("c2", "")).ok);
        assert.equal(store.cameras.get("c2")!.deviceSerial, null);
        assert.equal(store.audits.at(-1)!.action, "camera.serial.clear");
        assert.ok((await service.mapCameraSerial("c11", "SERIAL11")).ok);
    });

    it("batas dihitung per kontraktor dan memakai deviceLimit akun bila ada", async () => {
        for (let i = 1; i <= 10; i++) await service.mapCameraSerial(`c${i}`, `SERIAL${String(i).padStart(2, "0")}`);
        assert.ok((await service.mapCameraSerial("x1", "KONTRAKTOR2")).ok); // kontraktor lain tidak terpengaruh

        await service.saveAccount("k2", { appKey: "key-1", appSecret: "secret-1" });
        store.setDeviceLimit("acc1", 1);
        store.addCamera({ id: "x2", contractorId: "k2", label: "CAM-Y" });
        const r = await service.mapCameraSerial("x2", "KONTRAKTOR3");
        assert.ok(!r.ok && /Batas 1 perangkat/.test(r.error));
    });

    it("tanpa perubahan → changed false tanpa audit", async () => {
        await service.mapCameraSerial("c1", "BD7712045");
        const audits = store.audits.length;
        const r = await service.mapCameraSerial("c1", "bd7712045");
        assert.ok(r.ok && !r.changed);
        assert.equal(store.audits.length, audits);
    });

    it("mapCameraSerials memproses pelepasan lebih dulu agar slot terbebas", async () => {
        for (let i = 1; i <= 10; i++) await service.mapCameraSerial(`c${i}`, `SERIAL${String(i).padStart(2, "0")}`);
        const results = await service.mapCameraSerials([
            { cameraId: "c11", serial: "BARU0011" }, // butuh slot
            { cameraId: "c3", serial: "" }, // membebaskan slot
        ]);
        assert.ok(results.every((r) => r.result.ok));
        assert.equal(await store.countMappedCameras("k1"), 10);
        assert.equal(store.cameras.get("c11")!.deviceSerial, "BARU0011");
    });
});

describe("diffDevices", () => {
    const cams = [
        { id: "1", label: "A", area: "", storeId: "s", storeName: "S", storeCode: "c", deviceSerial: "abc123" },
        { id: "2", label: "B", area: "", storeId: "s", storeName: "S", storeCode: "c", deviceSerial: null },
    ];

    it("tidak peduli huruf besar/kecil dan spasi", () => {
        const d = diffDevices([{ deviceSerial: " ABC123 ", deviceName: "x", status: 1 }], cams);
        assert.equal(d.matched.length, 1);
        assert.equal(d.onlyInEzviz.length, 0);
        assert.equal(d.onlyInSystem.length, 0);
        assert.equal(d.unmappedCameras, 1);
    });

    it("status -1 → online null", () => {
        assert.equal(diffDevices([{ deviceSerial: "ABC123", deviceName: "x", status: -1 }], cams).matched[0].online, null);
    });
});

describe("describeError", () => {
    it("memetakan error EZVIZ ke pesan Indonesia yang aman", () => {
        assert.match(describeError(new CredentialError("x", 10017)), /appKey tidak ditemukan/);
        assert.match(describeError(new CredentialError("x", 10030)), /tidak cocok/);
        assert.match(describeError(new CredentialError("x", 10005)), /dibekukan/);
        assert.match(describeError(new RateLimitError("x", 10029, "frequency")), /Batas panggilan/);
        assert.match(describeError(new TransientError("detail internal")), /Gagal menghubungi/);
        assert.match(describeError(new DeviceNotFoundError("x", 20002)), /tidak ditemukan/);
        assert.match(describeError(new TypeError("bug")), /tak terduga/);
    });

    it("pesan tidak membocorkan detail error internal", () => {
        assert.ok(!describeError(new TransientError("token=at.rahasia")).includes("at.rahasia"));
    });
});
