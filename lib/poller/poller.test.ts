import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { GatewayError } from "@/lib/cameras/errors";
import type {
    CameraGateway,
    ConnectionState,
    DeviceCheck,
    LiveStream,
    RecordingRange,
    SnapshotImage,
} from "@/lib/cameras/gateway";
import type { SdStatusValue } from "@/lib/ezviz/mappers";
import { loadPollerConfig } from "./config";
import { MemoryPollerStore } from "./memory-poller-store";
import { pollAccount, pollAllAccounts, type PollDeps } from "./poller";
import type { SnapshotStorage } from "./snapshot-storage";

const MIN = 60_000;

class FakeGateway implements CameraGateway {
    readonly kind = "mock" as const;
    devices = new Map<string, ConnectionState>();
    listError: GatewayError | null = null;
    listCalls = 0;
    sd: SdStatusValue | null = "OK";
    sdError: GatewayError | null = null;
    sdCalls = 0;
    snapError: GatewayError | null = null;
    snapCalls = 0;

    async checkAccountDevices(): Promise<DeviceCheck[]> {
        this.listCalls++;
        if (this.listError) throw this.listError;
        return [...this.devices].map(([deviceSerial, connection]) => ({ deviceSerial, connection, deviceType: "H8c", encrypted: false }));
    }
    async getSdStatus() {
        this.sdCalls++;
        if (this.sdError) throw this.sdError;
        return this.sd;
    }
    async captureSnapshot(): Promise<SnapshotImage> {
        this.snapCalls++;
        if (this.snapError) throw this.snapError;
        return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
    }
    async startLive(): Promise<LiveStream> {
        throw new Error("tidak dipakai");
    }
    async stopLive() {}
    async getPlayerAccess(): Promise<never> {
        throw new GatewayError("unsupported", "tidak dipakai di tes poller");
    }
    async listRecordings(): Promise<RecordingRange[]> {
        return [];
    }
}

let store: MemoryPollerStore;
let gateway: FakeGateway;
let saved: string[];
let clock: Date;
let deps: PollDeps;

const snapshots: SnapshotStorage = {
    async save(cameraId) {
        saved.push(cameraId);
        return `${cameraId}.jpg`;
    },
};

const advance = (minutes: number) => {
    clock = new Date(clock.getTime() + minutes * MIN);
};

beforeEach(() => {
    store = new MemoryPollerStore();
    gateway = new FakeGateway();
    saved = [];
    clock = new Date("2026-10-15T03:00:00Z"); // 10:00 WIB
    deps = { store, gateway, snapshots, config: loadPollerConfig({}), now: () => clock };
    store.addCamera("acc", { id: "cam1" });
    gateway.devices.set("CAM1", "ONLINE");
});

const cam = () => store.cameras.get("cam1")!;
const events = () => store.events.get("cam1") ?? [];

describe("pollAccount: pengamatan pertama", () => {
    it("UNKNOWN → ONLINE: event, statusSince, uptime, MicroSD, dan snapshot tersimpan", async () => {
        const r = await pollAccount("acc", deps);
        assert.equal(r.checked, 1);
        assert.equal(r.changed, 1);
        assert.equal(r.snapshots, 1);
        assert.equal(cam().status, "ONLINE");
        assert.deepEqual(cam().statusSince, clock);
        assert.deepEqual(cam().lastCheckedAt, clock);
        assert.equal(cam().disconnectsToday, 0);
        assert.equal(cam().sdCheckedAt?.getTime(), clock.getTime());
        assert.equal(cam().snapshotPath, "cam1.jpg");
        assert.deepEqual(events().map((e) => e.status), ["ONLINE"]);
        assert.equal(gateway.listCalls, 1);
    });

    it("kamera tanpa serial dilewati; akun tanpa kamera tidak memanggil EZVIZ", async () => {
        store.addCamera("kosong", { id: "x", deviceSerial: null });
        const r = await pollAccount("kosong", deps);
        assert.equal(r.checked, 0);
        assert.equal(gateway.listCalls, 0);
    });
});

describe("pollAccount: kamera tanpa riwayat event", () => {
    it("status sudah terisi tetapi belum ada event → event dasar dicatat, uptime terhitung", async () => {
        store.cameras.get("cam1")!.status = "ONLINE"; // mis. dari seed/impor: tidak ada perubahan koneksi
        const r = await pollAccount("acc", deps);
        assert.equal(r.changed, 1);
        assert.deepEqual(events().map((e) => e.status), ["ONLINE"]);
        assert.equal(cam().uptime7d, null); // belum ada waktu yang terukur pada pengamatan pertama

        advance(5);
        const again = await pollAccount("acc", deps);
        assert.equal(again.changed, 0); // event dasar hanya sekali
        assert.equal(events().length, 1);
        assert.equal(cam().uptime7d, 100);
    });

    it("kamera OFFLINE tanpa riwayat → event dasar OFFLINE (bukan dihitung putus)", async () => {
        store.cameras.get("cam1")!.status = "OFFLINE";
        gateway.devices.set("CAM1", "OFFLINE");
        await pollAccount("acc", deps);
        assert.deepEqual(events().map((e) => e.status), ["OFFLINE"]);
        assert.equal(cam().disconnectsToday, 0);
    });
});

describe("pollAccount: siklus berikutnya", () => {
    it("tanpa perubahan: tidak ada event baru, MicroSD dan snapshot menunggu jeda", async () => {
        await pollAccount("acc", deps);
        advance(5);
        const r = await pollAccount("acc", deps);
        assert.equal(r.changed, 0);
        assert.equal(events().length, 1);
        assert.equal(gateway.sdCalls, 1);
        assert.equal(gateway.snapCalls, 1);
        assert.equal(cam().statusSince?.getTime(), new Date("2026-10-15T03:00:00Z").getTime()); // tidak bergeser
    });

    it("MicroSD dicek ulang setelah 30 menit, snapshot setelah 15 menit", async () => {
        await pollAccount("acc", deps);
        advance(15);
        await pollAccount("acc", deps);
        assert.equal(gateway.snapCalls, 2);
        assert.equal(gateway.sdCalls, 1);
        advance(15);
        await pollAccount("acc", deps);
        assert.equal(gateway.sdCalls, 2);
    });

    it("perubahan MicroSD membuat event baru", async () => {
        await pollAccount("acc", deps);
        gateway.sd = "UNREADABLE";
        advance(30);
        const r = await pollAccount("acc", deps);
        assert.equal(r.changed, 1);
        assert.equal(cam().sdStatus, "UNREADABLE");
        assert.equal(events().at(-1)!.sdStatus, "UNREADABLE");
    });

    it("MicroSD null (tidak dilaporkan) mempertahankan nilai terakhir", async () => {
        store.cameras.get("cam1")!.sdStatus = "NOT_FORMATTED";
        gateway.sd = null;
        await pollAccount("acc", deps);
        assert.equal(cam().sdStatus, "NOT_FORMATTED");
    });
});

describe("pollAccount: offline dan tidak stabil", () => {
    it("ONLINE → OFFLINE: status, putus 1×, tanpa snapshot/MicroSD saat offline", async () => {
        await pollAccount("acc", deps);
        advance(5);
        gateway.devices.set("CAM1", "OFFLINE");
        const sdBefore = gateway.sdCalls;
        const snapBefore = gateway.snapCalls;
        await pollAccount("acc", deps);

        assert.equal(cam().status, "OFFLINE");
        assert.equal(cam().disconnectsToday, 1);
        assert.deepEqual(cam().statusSince, clock);
        assert.equal(gateway.sdCalls, sdBefore);
        assert.equal(gateway.snapCalls, snapBefore);
    });

    it("tiga kali putus hari ini → UNSTABLE saat kembali online", async () => {
        await pollAccount("acc", deps);
        for (let i = 0; i < 3; i++) {
            advance(5);
            gateway.devices.set("CAM1", "OFFLINE");
            await pollAccount("acc", deps);
            advance(5);
            gateway.devices.set("CAM1", "ONLINE");
            await pollAccount("acc", deps);
        }
        assert.equal(cam().disconnectsToday, 3);
        assert.equal(cam().status, "UNSTABLE");

        // tetap UNSTABLE pada siklus online berikutnya; tidak membuat event baru
        const count = events().length;
        advance(5);
        await pollAccount("acc", deps);
        assert.equal(cam().status, "UNSTABLE");
        assert.equal(events().length, count);
    });

    it("dua kali putus belum dianggap tidak stabil", async () => {
        await pollAccount("acc", deps);
        for (let i = 0; i < 2; i++) {
            advance(5);
            gateway.devices.set("CAM1", "OFFLINE");
            await pollAccount("acc", deps);
            advance(5);
            gateway.devices.set("CAM1", "ONLINE");
            await pollAccount("acc", deps);
        }
        assert.equal(cam().status, "ONLINE");
    });

    it("uptime 7 hari turun setelah offline lama", async () => {
        await pollAccount("acc", deps);
        advance(60);
        gateway.devices.set("CAM1", "OFFLINE");
        await pollAccount("acc", deps);
        advance(60);
        await pollAccount("acc", deps);
        assert.equal(cam().uptime7d, 50); // 1 jam online, 1 jam offline
    });

    it("perangkat hilang dari akun → UNKNOWN dengan catatan, bukan offline", async () => {
        await pollAccount("acc", deps);
        gateway.devices.clear();
        advance(5);
        await pollAccount("acc", deps);
        assert.equal(cam().status, "UNKNOWN");
        assert.match(events().at(-1)!.note ?? "", /tidak ada di akun/);
        assert.equal(cam().disconnectsToday, 0); // ONLINE → UNKNOWN bukan putus
    });
});

describe("pollAccount: kegagalan", () => {
    it("daftar perangkat gagal (akun bermasalah) → status kamera tidak berubah", async () => {
        await pollAccount("acc", deps);
        const before = { ...cam() };
        gateway.listError = new GatewayError("account_unavailable", "x");
        advance(5);
        const r = await pollAccount("acc", deps);
        assert.equal(r.error, "account_unavailable");
        assert.equal(r.checked, 0);
        assert.equal(cam().status, before.status);
        assert.deepEqual(cam().lastCheckedAt, before.lastCheckedAt);
        assert.equal(events().length, 1);
    });

    it("gangguan sementara dan rate limit pada daftar perangkat dilaporkan, tidak melempar", async () => {
        gateway.listError = new GatewayError("transient", "x");
        assert.equal((await pollAccount("acc", deps)).error, "transient");
        gateway.listError = new GatewayError("rate_limited", "x");
        assert.equal((await pollAccount("acc", deps)).error, "rate_limited");
    });

    it("error tak terduga (bukan GatewayError) diteruskan ke pemanggil", async () => {
        gateway.checkAccountDevices = async () => {
            throw new TypeError("bug");
        };
        await assert.rejects(pollAccount("acc", deps), TypeError);
    });

    it("snapshot gagal: status tetap diperbarui, dicoba lagi setelah jeda", async () => {
        gateway.snapError = new GatewayError("transient", "x");
        const r = await pollAccount("acc", deps);
        assert.equal(r.snapshots, 0);
        assert.equal(cam().status, "ONLINE");
        assert.equal(cam().snapshotPath, undefined);
        assert.ok(cam().snapshotTriedAt);

        advance(5);
        await pollAccount("acc", deps);
        assert.equal(gateway.snapCalls, 1); // belum waktunya

        gateway.snapError = null;
        advance(10);
        await pollAccount("acc", deps);
        assert.equal(gateway.snapCalls, 2);
        assert.equal(cam().snapshotPath, "cam1.jpg");
    });

    it("kegagalan menyimpan snapshot ke disk tidak menggagalkan siklus", async () => {
        const broken: PollDeps = { ...deps, snapshots: { save: async () => { throw new Error("disk penuh"); } } };
        const r = await pollAccount("acc", broken);
        assert.equal(r.checked, 1);
        assert.equal(cam().status, "ONLINE");
    });

    it("rate limit saat MicroSD menghentikan pengecekan MicroSD akun itu, status tetap diperbarui", async () => {
        store.addCamera("acc", { id: "cam2" });
        gateway.devices.set("CAM2", "ONLINE");
        gateway.sdError = new GatewayError("rate_limited", "x");
        const r = await pollAccount("acc", deps);
        assert.equal(r.rateLimited, true);
        assert.equal(r.checked, 2);
        assert.equal(gateway.sdCalls, 1); // kamera kedua tidak dicoba
        assert.equal(store.cameras.get("cam2")!.status, "ONLINE");
    });

    it("rate limit saat snapshot menghentikan snapshot berikutnya pada siklus yang sama", async () => {
        store.addCamera("acc", { id: "cam2" });
        gateway.devices.set("CAM2", "ONLINE");
        gateway.snapError = new GatewayError("rate_limited", "x");
        const r = await pollAccount("acc", deps);
        assert.equal(r.rateLimited, true);
        assert.equal(gateway.snapCalls, 1);
    });
});

describe("pollAllAccounts", () => {
    it("satu akun gagal tidak menghentikan akun lain", async () => {
        store.addCamera("acc2", { id: "cam3" });
        gateway.devices.set("CAM3", "ONLINE");
        const original = gateway.checkAccountDevices.bind(gateway);
        gateway.checkAccountDevices = async function (this: FakeGateway, accountId: string) {
            if (accountId === "acc") throw new TypeError("akun pertama rusak");
            return original();
        } as typeof gateway.checkAccountDevices;

        const summary = await pollAllAccounts(deps);
        assert.equal(summary.accounts, 2);
        assert.equal(summary.crashed.length, 1);
        assert.equal(summary.crashed[0].accountId, "acc");
        assert.equal(summary.results.length, 1);
        assert.equal(store.cameras.get("cam3")!.status, "ONLINE");
    });

    it("membatasi konkurensi", async () => {
        for (let i = 0; i < 8; i++) store.addCamera(`a${i}`, { id: `c${i}` });
        let active = 0;
        let peak = 0;
        gateway.checkAccountDevices = async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 10));
            active--;
            return [];
        };
        await pollAllAccounts({ ...deps, config: { ...loadPollerConfig({}), concurrency: 2 } });
        assert.equal(peak, 2);
    });

    it("tanpa akun aktif → ringkasan kosong", async () => {
        const empty = new MemoryPollerStore();
        const summary = await pollAllAccounts({ ...deps, store: empty });
        assert.equal(summary.accounts, 0);
        assert.deepEqual(summary.results, []);
    });
});

describe("loadPollerConfig", () => {
    it("bawaan dan override dari env; nilai tidak valid diabaikan", () => {
        assert.deepEqual(loadPollerConfig({}), {
            unstableThreshold: 3,
            sdCheckIntervalMin: 30,
            snapshotIntervalMin: 15,
            snapshotQuality: 1,
            concurrency: 3,
        });
        const c = loadPollerConfig({ POLL_UNSTABLE_THRESHOLD: "5", POLL_CONCURRENCY: "abc", POLL_SD_INTERVAL_MIN: "0" });
        assert.equal(c.unstableThreshold, 5);
        assert.equal(c.concurrency, 3);
        assert.equal(c.sdCheckIntervalMin, 30);
    });
});
