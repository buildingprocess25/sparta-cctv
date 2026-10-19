import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { EzvizClient } from "./client";
import {
    CredentialError,
    DeviceOfflineError,
    RateLimitError,
    TokenExpiredError,
    TransientError,
} from "./errors";
import { FakeEzvizServer } from "./testing/fake-server";

const server = new FakeEzvizServer();
let client: EzvizClient;

before(async () => {
    await server.start();
    client = new EzvizClient({ tokenBaseUrl: server.baseUrl, timeoutMs: 1000 });
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
});

async function login() {
    return client.getToken("key-1", "secret-1");
}

describe("EzvizClient.getToken", () => {
    it("mengurai accessToken, expireTime (ms), dan areaDomain", async () => {
        const before = Date.now();
        const token = await login();
        assert.match(token.accessToken, /^at\.fake-/);
        assert.equal(token.areaDomain, server.baseUrl);
        assert.ok(token.expiresAt.getTime() > before + 6 * 24 * 3_600_000);
    });

    it("mengirim appKey/appSecret sebagai form-urlencoded POST", async () => {
        await login();
        const req = server.callsTo("/api/lapp/token/get")[0];
        assert.equal(req.method, "POST");
        assert.match(String(req.headers["content-type"]), /application\/x-www-form-urlencoded/);
        assert.deepEqual(req.form, { appKey: "key-1", appSecret: "secret-1" });
    });

    it("appKey/appSecret salah → CredentialError tanpa membocorkan secret", async () => {
        await assert.rejects(client.getToken("key-1", "salah-total"), (e: Error) => {
            assert.ok(e instanceof CredentialError);
            assert.equal((e as CredentialError).code, 10030);
            assert.ok(!e.message.includes("salah-total"));
            return true;
        });
        await assert.rejects(client.getToken("tidak-ada", "x"), CredentialError);
    });
});

describe("EzvizClient endpoint lain", () => {
    it("listDevices menelusuri halaman (120 perangkat → 3 panggilan)", async () => {
        server.devices = Array.from({ length: 120 }, (_, i) => ({
            deviceSerial: `S${i}`,
            deviceName: `Cam ${i}`,
            deviceType: "H8c",
            status: i % 2,
            isEncrypt: 0,
            deviceVersion: "V1",
        }));
        const t = await login();
        const devices = await client.listDevices(t.areaDomain, t.accessToken);
        assert.equal(devices.length, 120);
        assert.equal(server.callsTo("/api/lapp/device/list").length, 3);
        assert.equal(devices[1].status, 1);
        assert.equal(devices[0].isEncrypt, false);
    });

    it("listDevices: satu panggilan untuk akun kecil (≤ 50 perangkat)", async () => {
        server.devices = [{ deviceSerial: "A", deviceName: "A", deviceType: "x", status: 1, isEncrypt: 0 }];
        const t = await login();
        const devices = await client.listDevices(t.areaDomain, t.accessToken);
        assert.equal(devices.length, 1);
        assert.equal(server.callsTo("/api/lapp/device/list").length, 1);
    });

    it("getDeviceStatus mengurai diskNum dan diskState", async () => {
        const t = await login();
        const s = await client.getDeviceStatus(t.areaDomain, t.accessToken, "D1");
        assert.deepEqual(s, { diskNum: 1, diskState: "0---------------" });
        assert.equal(server.callsTo("/api/lapp/device/status/get")[0].form.channel, "1");
    });

    it("getLiveAddress mengirim parameter HLS sub-stream dan mengurai respons", async () => {
        const t = await login();
        const live = await client.getLiveAddress(t.areaDomain, t.accessToken, {
            deviceSerial: "D1",
            protocol: 2,
            expireTime: 180,
            quality: 2,
        });
        const form = server.callsTo("/api/lapp/live/address/get")[0].form;
        assert.equal(form.protocol, "2");
        assert.equal(form.expireTime, "180");
        assert.equal(form.quality, "2");
        assert.equal(form.accessToken, t.accessToken);
        assert.equal(live.id, "live-1");
        assert.match(live.url, /\.m3u8$/);
    });

    it("getLiveAddress tidak mengirim parameter yang tidak diisi", async () => {
        const t = await login();
        await client.getLiveAddress(t.areaDomain, t.accessToken, { deviceSerial: "D1" });
        const form = server.callsTo("/api/lapp/live/address/get")[0].form;
        assert.deepEqual(Object.keys(form).sort(), ["accessToken", "deviceSerial"]);
    });

    it("disableLiveAddress mengirim urlId", async () => {
        const t = await login();
        await client.disableLiveAddress(t.areaDomain, t.accessToken, "D1", "live-1");
        assert.equal(server.callsTo("/api/lapp/live/address/disable")[0].form.urlId, "live-1");
    });

    it("captureSnapshot mengembalikan picUrl", async () => {
        const t = await login();
        assert.equal(await client.captureSnapshot(t.areaDomain, t.accessToken, "D1", 1, 1), `${server.baseUrl}/img/pic.jpg`);
    });

    it("queryLocalRecords: GET dengan token di header dan filter di query", async () => {
        server.overrides.set("/api/v3/das/device/local/video/query", () => ({
            body: {
                meta: { code: 200, message: "ok", moreInfo: null },
                data: [
                    { startTime: "2026-10-15T11:44:15", endTime: "2026-10-15T11:51:21", deviceSerial: "D1", cameraNo: "1", type: "TIMING", size: "" },
                ],
            },
        }));
        const t = await login();
        const rows = await client.queryLocalRecords(t.areaDomain, t.accessToken, "D1", {
            startTime: "2026-10-15 00:00:00",
            endTime: "2026-10-15 15:00:00",
        });
        const req = server.callsTo("/api/v3/das/device/local/video/query")[0];
        assert.equal(req.method, "GET");
        assert.equal(req.headers.accesstoken, t.accessToken);
        assert.equal(req.headers.deviceserial, "D1");
        assert.equal(req.query.startTime, "2026-10-15 00:00:00");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "TIMING");
        assert.equal(rows[0].channelNo, "1");
    });
});

describe("EzvizClient penanganan error", () => {
    it("token tidak valid → TokenExpiredError (kode 10002)", async () => {
        await assert.rejects(client.listDevices(server.baseUrl, "at.bukan-token"), TokenExpiredError);
    });

    it("v3: HTTP 401 tanpa kode → TokenExpiredError", async () => {
        await assert.rejects(client.queryLocalRecords(server.baseUrl, "at.bukan-token", "D1"), TokenExpiredError);
    });

    it("v3: error di dalam meta dengan HTTP 200 → DeviceOfflineError (2003)", async () => {
        server.overrides.set("/api/v3/das/device/local/video/query", () => ({
            body: { meta: { code: 2003, message: "Device offline" } },
        }));
        const t = await login();
        await assert.rejects(client.queryLocalRecords(t.areaDomain, t.accessToken, "D1"), DeviceOfflineError);
    });

    it("kode 20007 → DeviceOfflineError", async () => {
        server.overrides.set("/api/lapp/device/capture", () => ({ body: { code: "20007", msg: "The device is offline" } }));
        const t = await login();
        await assert.rejects(client.captureSnapshot(t.areaDomain, t.accessToken, "D1"), DeviceOfflineError);
    });

    it("10029 dan 10007 → RateLimitError dengan jenis berbeda", async () => {
        const t = await login();
        server.overrides.set("/api/lapp/device/list", () => ({ body: { code: "10029", msg: "frequency" } }));
        await assert.rejects(client.listDevices(t.areaDomain, t.accessToken), (e: Error) => {
            assert.ok(e instanceof RateLimitError);
            assert.equal((e as RateLimitError).kind, "frequency");
            return true;
        });
        server.overrides.set("/api/lapp/device/list", () => ({ body: { code: "10007", msg: "quota" } }));
        await assert.rejects(client.listDevices(t.areaDomain, t.accessToken), (e: Error) => {
            assert.equal((e as RateLimitError).kind, "quota");
            return true;
        });
    });

    it("49999 → TransientError", async () => {
        server.overrides.set("/api/lapp/device/list", () => ({ body: { code: "49999", msg: "Data exception" } }));
        const t = await login();
        await assert.rejects(client.listDevices(t.areaDomain, t.accessToken), TransientError);
    });

    it("respons bukan JSON → TransientError", async () => {
        server.overrides.set("/api/lapp/device/list", () => ({ status: 502, body: "<html>Bad gateway</html>" }));
        const t = await login();
        await assert.rejects(client.listDevices(t.areaDomain, t.accessToken), TransientError);
    });

    it("timeout → TransientError", async () => {
        server.overrides.set("/api/lapp/device/list", async () => {
            await new Promise((r) => setTimeout(r, 1500));
            return { body: { code: "200", data: [] } };
        });
        const t = await login();
        await assert.rejects(client.listDevices(t.areaDomain, t.accessToken), (e: Error) => {
            assert.ok(e instanceof TransientError);
            assert.match(e.message, /timeout/);
            return true;
        });
    });

    it("server tidak terjangkau → TransientError tanpa membocorkan token di pesan", async () => {
        const dead = new EzvizClient({ tokenBaseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
        await assert.rejects(dead.getToken("key-1", "secret-1"), (e: Error) => {
            assert.ok(e instanceof TransientError);
            assert.ok(!e.message.includes("secret-1"));
            return true;
        });
    });
});
