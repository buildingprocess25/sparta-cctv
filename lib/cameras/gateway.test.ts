import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { encryptSecret } from "@/lib/crypto";
import { EzvizClient } from "@/lib/ezviz/client";
import { MemoryAccountStore } from "@/lib/ezviz/memory-account-store";
import { formatEzvizTime, startOfDayWib } from "@/lib/ezviz/time";
import { FakeEzvizServer } from "@/lib/ezviz/testing/fake-server";
import { TokenManager } from "@/lib/ezviz/token-manager";
import { mockAccountId, mockSerial } from "@/lib/seed-data";
import { GatewayError, type GatewayErrorKind } from "./errors";
import { EzvizGateway } from "./ezviz-gateway";
import type { CameraGateway, DeviceRef } from "./gateway";
import { MockGateway } from "./mock-gateway";

const key = randomBytes(32);
const server = new FakeEzvizServer();
const store = new MemoryAccountStore();
const now = new Date("2026-10-15T08:30:00Z"); // 15:30 WIB
const dayStart = startOfDayWib(now);

let ezviz: EzvizGateway;

before(async () => {
    await server.start();
    const client = new EzvizClient({ tokenBaseUrl: server.baseUrl, timeoutMs: 1000 });
    const tokens = new TokenManager({ store, client, key, now: () => now });
    ezviz = new EzvizGateway({ client, tokens, now: () => now });
});
after(() => server.stop());

function addAccount(id: string, appKey = "key-1", secret = "secret-1", status: "ACTIVE" | "DISABLED" = "ACTIVE") {
    store.add({
        id,
        appKey,
        appSecretEnc: encryptSecret(secret, { key, aad: `${id}:appSecret` }),
        accessTokenEnc: null,
        tokenExpiresAt: null,
        areaDomain: null,
        status,
    });
}

beforeEach(() => {
    store.accounts.clear();
    server.credentials.clear();
    server.credentials.set("key-1", "secret-1");
    server.validTokens.clear();
    server.overrides.clear();
    server.requests.length = 0;
    server.tokenCalls = 0;
    server.devices = [];
    addAccount("acc-1");
});

const ref: DeviceRef = { accountId: "acc-1", deviceSerial: "D1", channelNo: 1 };

async function kindOf(promise: Promise<unknown>): Promise<GatewayErrorKind> {
    try {
        await promise;
    } catch (error) {
        assert.ok(error instanceof GatewayError, `bukan GatewayError: ${String(error)}`);
        return error.kind;
    }
    assert.fail("seharusnya gagal");
}

// ---------------------------------------------------------------------------
// Kontrak yang harus dipenuhi SEMUA implementasi gateway
// ---------------------------------------------------------------------------

function contract(name: string, make: () => { gateway: CameraGateway; ref: DeviceRef }) {
    describe(`kontrak CameraGateway: ${name}`, () => {
        it("listRecordings: terurut, tidak tumpang tindih, dan terpotong ke rentang", async () => {
            const { gateway, ref } = make();
            const range = { start: new Date(dayStart.getTime() + 2 * 3_600_000), end: now };
            const segments = await gateway.listRecordings(ref, range);
            for (let i = 0; i < segments.length; i++) {
                assert.ok(segments[i].end > segments[i].start);
                assert.ok(segments[i].start >= range.start && segments[i].end <= range.end);
                if (i > 0) assert.ok(segments[i].start >= segments[i - 1].end);
            }
        });

        it("startLive mengembalikan URL HLS dan waktu kedaluwarsa", async () => {
            const { gateway, ref } = make();
            const live = await gateway.startLive(ref, { expireSeconds: 180 });
            assert.match(live.url, /\.m3u8/);
            assert.ok(live.id.length > 0);
            assert.ok(live.expiresAt instanceof Date);
        });

        it("stopLive tidak melempar error", async () => {
            const { gateway, ref } = make();
            const live = await gateway.startLive(ref, { expireSeconds: 180 });
            await gateway.stopLive(ref, live.id);
        });

        it("captureSnapshot mengembalikan bytes gambar", async () => {
            const { gateway, ref } = make();
            const img = await gateway.captureSnapshot(ref);
            assert.ok(img.bytes.byteLength > 0);
            assert.match(img.contentType, /^image\//);
        });

        it("getSdStatus mengembalikan status valid atau null", async () => {
            const { gateway, ref } = make();
            const sd = await gateway.getSdStatus(ref);
            assert.ok(sd === null || ["OK", "NOT_FORMATTED", "UNREADABLE", "NONE"].includes(sd));
        });
    });
}

contract("mock", () => ({
    gateway: new MockGateway(() => now),
    ref: { accountId: mockAccountId(0), deviceSerial: mockSerial(0, 0), channelNo: 1 },
}));

contract("ezviz (server palsu)", () => {
    server.devices = [{ deviceSerial: "D1", deviceName: "Cam", deviceType: "H8c", status: 1, isEncrypt: 0 }];
    server.overrides.set("/api/v3/das/device/local/video/query", () => ({
        body: {
            meta: { code: 200, message: "ok", moreInfo: null },
            data: [
                { startTime: "2026-10-15T09:00:00", endTime: "2026-10-15T10:30:00", deviceSerial: "D1", cameraNo: "1", type: "TIMING" },
                { startTime: "2026-10-15T07:00:00", endTime: "2026-10-15T08:00:00", deviceSerial: "D1", cameraNo: "1", type: "TIMING" },
            ],
        },
    }));
    return { gateway: ezviz, ref };
});

// ---------------------------------------------------------------------------
// Perilaku khusus MockGateway
// ---------------------------------------------------------------------------

describe("MockGateway", () => {
    const mock = new MockGateway(() => now);

    it("kamera offline: rekaman berhenti sejak offline, snapshot/live ditolak", async () => {
        // ALF-BGR-0388 CAM-02 (toko ke-2, kamera ke-2): offline sejak 87 menit lalu, MicroSD tidak terbaca
        const offlineRef = { accountId: mockAccountId(0), deviceSerial: mockSerial(1, 1), channelNo: 1 };
        assert.deepEqual(await mock.listRecordings(offlineRef, { start: dayStart, end: now }), []); // UNREADABLE → tidak ada rekaman
        assert.equal(await kindOf(mock.captureSnapshot(offlineRef)), "offline");
        assert.equal(await kindOf(mock.startLive(offlineRef, { expireSeconds: 180 })), "offline");
    });

    it("serial tidak dikenal → not_found", async () => {
        assert.equal(await kindOf(mock.getSdStatus({ accountId: "x", deviceSerial: "TIDAK-ADA", channelNo: 1 })), "not_found");
    });

    it("checkAccountDevices hanya mengembalikan perangkat milik akun itu", async () => {
        const checks = await mock.checkAccountDevices(mockAccountId(0));
        assert.ok(checks.length > 0);
        assert.ok(checks.some((c) => c.connection === "OFFLINE"));
        assert.deepEqual(await mock.checkAccountDevices("mock-tidak-ada"), []);
    });
});

// ---------------------------------------------------------------------------
// Perilaku khusus EzvizGateway
// ---------------------------------------------------------------------------

describe("EzvizGateway", () => {
    it("checkAccountDevices memetakan status dan memakai satu panggilan list", async () => {
        server.devices = [
            { deviceSerial: "A", deviceName: "A", deviceType: "H8c", status: 1, isEncrypt: 0 },
            { deviceSerial: "B", deviceName: "B", deviceType: "H8c", status: 0, isEncrypt: 1 },
            { deviceSerial: "C", deviceName: "C", deviceType: "H8c", status: -1, isEncrypt: 0 },
        ];
        const checks = await ezviz.checkAccountDevices("acc-1");
        assert.deepEqual(
            checks.map((c) => [c.deviceSerial, c.connection, c.encrypted]),
            [
                ["A", "ONLINE", false],
                ["B", "OFFLINE", true],
                ["C", "UNKNOWN", false],
            ],
        );
        assert.equal(server.callsTo("/api/lapp/device/list").length, 1);
    });

    it("token kedaluwarsa di sisi EZVIZ ditangani transparan (refresh + ulang)", async () => {
        await ezviz.checkAccountDevices("acc-1");
        server.expireAllTokens();
        await ezviz.checkAccountDevices("acc-1");
        assert.equal(server.tokenCalls, 2);
    });

    it("startLive: HLS, sub-stream, expireTime sesuai permintaan", async () => {
        const live = await ezviz.startLive(ref, { expireSeconds: 180 });
        const form = server.callsTo("/api/lapp/live/address/get")[0].form;
        assert.equal(form.protocol, "2");
        assert.equal(form.quality, "2");
        assert.equal(form.expireTime, "180");
        assert.equal(form.type, "1");
        assert.equal(form.deviceSerial, "D1");
        assert.equal(live.id, "live-1");
    });

    it("startLive dengan playback mengirim type=2 dan rentang waktu WIB", async () => {
        const start = new Date("2026-10-15T06:00:00Z"); // 13:00 WIB
        const end = new Date("2026-10-15T07:00:00Z"); // 14:00 WIB
        await ezviz.startLive(ref, { expireSeconds: 180, quality: 1, playback: { start, end } });
        const form = server.callsTo("/api/lapp/live/address/get")[0].form;
        assert.equal(form.type, "2");
        assert.equal(form.quality, "1");
        assert.equal(form.startTime, "2026-10-15 13:00:00");
        assert.equal(form.stopTime, "2026-10-15 14:00:00");
    });

    it("stopLive memanggil disable dengan urlId", async () => {
        await ezviz.stopLive(ref, "live-1");
        assert.equal(server.callsTo("/api/lapp/live/address/disable")[0].form.urlId, "live-1");
    });

    it("ptz start mengirim arah dan kecepatan sedang; stop tanpa arah", async () => {
        await ezviz.ptz(ref, { action: "start", move: "left" });
        await ezviz.ptz(ref, { action: "stop" });
        const start = server.callsTo("/api/lapp/device/ptz/start")[0].form;
        assert.equal(start.deviceSerial, "D1");
        assert.equal(start.channelNo, "1");
        assert.equal(start.direction, "2");
        assert.equal(start.speed, "1");
        const stop = server.callsTo("/api/lapp/device/ptz/stop")[0].form;
        assert.equal(stop.direction, undefined);
    });

    it("ptz di batas putar (60004) → ptz_limit; tanpa dukungan PTZ (60000) → unsupported", async () => {
        server.overrides.set("/api/lapp/device/ptz/start", () => ({ body: { code: "60004", msg: "left limit" } }));
        assert.equal(await kindOf(ezviz.ptz(ref, { action: "start", move: "left" })), "ptz_limit");
        server.overrides.set("/api/lapp/device/ptz/start", () => ({ body: { code: "60000", msg: "no ptz" } }));
        assert.equal(await kindOf(ezviz.ptz(ref, { action: "start", move: "up" })), "unsupported");
    });

    it("captureSnapshot mengunduh gambar dari picUrl", async () => {
        const img = await ezviz.captureSnapshot(ref, { quality: 1 });
        assert.equal(img.contentType, "image/jpeg");
        assert.deepEqual([...img.bytes], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
        assert.equal(server.callsTo("/api/lapp/device/capture")[0].form.quality, "1");
    });

    it("captureSnapshot: unduhan bukan gambar → transient", async () => {
        server.overrides.set("/img/pic.jpg", () => ({ body: { oops: true } }));
        assert.equal(await kindOf(ezviz.captureSnapshot(ref)), "transient");
    });

    it("listRecordings: waktu dikonversi dari WIB, terpotong ke rentang, urut", async () => {
        server.overrides.set("/api/v3/das/device/local/video/query", () => ({
            body: {
                meta: { code: 200, message: "ok" },
                data: [
                    { startTime: "2026-10-15T09:00:00", endTime: "2026-10-15T10:30:00", deviceSerial: "D1", cameraNo: "1", type: "TIMING" },
                    { startTime: "2026-10-15T07:00:00", endTime: "2026-10-15T08:00:00", deviceSerial: "D1", cameraNo: "1", type: "TIMING" },
                    { startTime: "rusak", endTime: "rusak", deviceSerial: "D1", cameraNo: "1", type: "TIMING" },
                ],
            },
        }));
        const range = { start: new Date("2026-10-15T01:30:00Z"), end: new Date("2026-10-15T08:00:00Z") }; // 08:30–15:00 WIB
        const segments = await ezviz.listRecordings(ref, range);
        // 09:00–10:30 WIB berada di dalam rentang; 07:00–08:00 WIB di luar rentang (dibuang); baris rusak diabaikan.
        assert.deepEqual(
            segments.map((s) => [s.start.toISOString(), s.end.toISOString()]),
            [["2026-10-15T02:00:00.000Z", "2026-10-15T03:30:00.000Z"]],
        );
        const q = server.callsTo("/api/v3/das/device/local/video/query")[0].query;
        assert.equal(q.startTime, formatEzvizTime(range.start));
        assert.equal(q.endTime, formatEzvizTime(range.end));
    });

    describe("terjemahan error", () => {
        const cases: [string, number, GatewayErrorKind][] = [
            ["perangkat offline", 20007, "offline"],
            ["perangkat bukan milik akun", 20018, "not_found"],
            ["tidak didukung", 60020, "unsupported"],
            ["batas frekuensi", 10029, "rate_limited"],
            ["batas kuota", 10007, "rate_limited"],
            ["gangguan data", 49999, "transient"],
        ];
        for (const [label, code, kind] of cases) {
            it(`${label} (${code}) → ${kind}`, async () => {
                server.overrides.set("/api/lapp/device/capture", () => ({ body: { code: String(code), msg: "x" } }));
                assert.equal(await kindOf(ezviz.captureSnapshot(ref)), kind);
            });
        }

        it("kredensial salah → account_unavailable", async () => {
            server.credentials.set("key-1", "secret-baru");
            assert.equal(await kindOf(ezviz.checkAccountDevices("acc-1")), "account_unavailable");
        });

        it("akun DISABLED → account_unavailable tanpa panggilan jaringan", async () => {
            addAccount("acc-off", "key-1", "secret-1", "DISABLED");
            assert.equal(await kindOf(ezviz.checkAccountDevices("acc-off")), "account_unavailable");
            assert.equal(server.requests.length, 0);
        });

        it("kontraktor tanpa akun (accountId null) → account_unavailable", async () => {
            assert.equal(await kindOf(ezviz.getSdStatus({ accountId: null, deviceSerial: "D1", channelNo: 1 })), "account_unavailable");
        });

        it("serial belum diisi → not_found", async () => {
            assert.equal(await kindOf(ezviz.getSdStatus({ accountId: "acc-1", deviceSerial: null, channelNo: 1 })), "not_found");
        });
    });
});
