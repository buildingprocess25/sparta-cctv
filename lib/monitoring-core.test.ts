import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applyAccountOverride,
    buildContractorLive,
    buildDashboard,
    deriveConnectivity,
    pickLiveCameras,
    toMinuteSegments,
    type CameraStatus,
    type CameraView,
    type EzvizAccountState,
    type SdStatus,
    type StoreView,
} from "./monitoring-core";

const now = new Date("2026-10-15T08:30:00Z");

function cam(label: string, status: CameraStatus = "ONLINE", sdStatus: SdStatus = "OK", extra: Partial<CameraView> = {}): CameraView {
    return {
        id: `s:${label}`,
        label,
        area: "Area",
        status,
        statusSince: status === "ONLINE" ? null : new Date(now.getTime() - 3_600_000),
        disconnectsToday: 0,
        sdStatus,
        uptime7d: 99,
        lastSnapshotAt: now,
        snapshotUrl: null,
        deviceModel: null,
        deviceSerial: label,
        channelNo: 1,
        ...extra,
    };
}

function store(
    name: string,
    contractor: string,
    cameras: CameraView[],
    account: EzvizAccountState | null = "ACTIVE",
): StoreView {
    return {
        id: name,
        code: `CODE-${name}`,
        name,
        address: "Alamat",
        contractorId: `id-${contractor}`,
        contractorName: contractor,
        contractorPhone: "0812",
        contractorPic: null,
        ezvizAccount: account ? { id: `acc-${contractor}`, status: account, lastError: null } : null,
        progress: 50,
        targetDate: null,
        cameras: cameras.map((c) => ({ ...c, id: `${name}:${c.label}` })),
    };
}

describe("applyAccountOverride", () => {
    it("akun TOKEN_ERROR/DISABLED → semua kamera UNKNOWN, bukan offline", () => {
        for (const state of ["TOKEN_ERROR", "DISABLED"] as const) {
            const [s] = applyAccountOverride([store("A", "K1", [cam("1"), cam("2", "OFFLINE")], state)]);
            assert.deepEqual(s.cameras.map((c) => c.status), ["UNKNOWN", "UNKNOWN"]);
            assert.ok(s.cameras.every((c) => c.statusSince === null));
        }
    });

    it("akun ACTIVE atau belum ada akun → status apa adanya", () => {
        const [a] = applyAccountOverride([store("A", "K1", [cam("1", "OFFLINE")], "ACTIVE")]);
        const [b] = applyAccountOverride([store("B", "K1", [cam("1", "UNSTABLE")], null)]);
        assert.equal(a.cameras[0].status, "OFFLINE");
        assert.equal(b.cameras[0].status, "UNSTABLE");
    });

    it("tidak mengubah data masukan", () => {
        const input = [store("A", "K1", [cam("1")], "DISABLED")];
        applyAccountOverride(input);
        assert.equal(input[0].cameras[0].status, "ONLINE");
    });
});

describe("buildDashboard: statistik", () => {
    const data = buildDashboard(
        applyAccountOverride([
            store("A", "K1", [cam("1"), cam("2", "OFFLINE"), cam("3", "UNSTABLE"), cam("4", "ONLINE", "UNREADABLE")]),
            store("B", "K2", [cam("1", "ONLINE", "NOT_FORMATTED"), cam("2", "OFFLINE", "UNREADABLE")]),
            store("C", "K3", [cam("1"), cam("2")], "TOKEN_ERROR"),
        ]),
        now,
    );

    it("menghitung online, offline, tidak stabil, tidak diketahui", () => {
        assert.equal(data.stats.total, 8);
        assert.equal(data.stats.online, 3);
        assert.equal(data.stats.offline, 2);
        assert.equal(data.stats.unstable, 1);
        assert.equal(data.stats.unknown, 2);
        assert.equal(data.stats.stores, 3);
    });

    it("MicroSD bermasalah tidak dihitung untuk kamera offline/unknown", () => {
        assert.equal(data.stats.sdProblems, 2); // A:4 dan B:1; B:2 offline tidak dihitung
    });

    it("kamera UNKNOWN tidak dihitung online", () => {
        assert.ok(data.stats.online + data.stats.offline + data.stats.unstable + data.stats.unknown === data.stats.total);
    });
});

describe("buildDashboard: alert", () => {
    it("satu alert per akun bermasalah, tanpa alert per kamera UNKNOWN", () => {
        const data = buildDashboard(
            applyAccountOverride([
                store("C1", "K3", [cam("1"), cam("2")], "TOKEN_ERROR"),
                store("C2", "K3", [cam("1")], "TOKEN_ERROR"), // kontraktor sama, toko lain
                store("D", "K4", [cam("1")], "DISABLED"),
            ]),
            now,
        );
        const accountAlerts = data.alerts.filter((a) => a.kind === "account");
        assert.equal(accountAlerts.length, 2);
        assert.equal(data.alerts.length, 2);
        const k3 = accountAlerts.find((a) => a.contractorName === "K3")!;
        assert.equal(k3.unknownCount, 3);
        assert.equal(k3.accountState, "TOKEN_ERROR");
        assert.equal(accountAlerts.find((a) => a.contractorName === "K4")!.accountState, "DISABLED");
    });

    it("urutan: offline → akun → tidak stabil → MicroSD", () => {
        const data = buildDashboard(
            applyAccountOverride([
                store("A", "K1", [cam("1", "ONLINE", "NOT_FORMATTED"), cam("2", "UNSTABLE"), cam("3", "OFFLINE")]),
                store("B", "K2", [cam("1")], "TOKEN_ERROR"),
            ]),
            now,
        );
        assert.deepEqual(data.alerts.map((a) => a.kind), ["offline", "account", "unstable", "sd"]);
    });

    it("offline: yang terbaru lebih dulu", () => {
        const older = cam("1", "OFFLINE", "OK", { statusSince: new Date(now.getTime() - 5 * 3_600_000) });
        const newer = cam("2", "OFFLINE", "OK", { statusSince: new Date(now.getTime() - 3_600_000) });
        const data = buildDashboard([store("A", "K1", [older, newer])], now);
        assert.deepEqual(data.alerts.map((a) => a.cameraLabel), ["2", "1"]);
    });

    it("semua sehat → tanpa alert", () => {
        assert.equal(buildDashboard([store("A", "K1", [cam("1"), cam("2")])], now).alerts.length, 0);
    });
});

describe("buildDashboard: filter dan urutan", () => {
    const stores = applyAccountOverride([
        store("Zeta", "K1", [cam("1")]),
        store("Alfa", "K2", [cam("1", "OFFLINE")]),
        store("Beta", "K1", [cam("1")]),
        store("Gamma", "K3", [cam("1")], "TOKEN_ERROR"),
    ]);

    it("toko bermasalah dulu, lalu urut nama", () => {
        assert.deepEqual(buildDashboard(stores, now).stores.map((s) => s.name), ["Alfa", "Gamma", "Beta", "Zeta"]);
    });

    it("filter kontraktor, dan daftar kontraktor tetap lengkap", () => {
        const data = buildDashboard(stores, now, { contractor: "K1" });
        assert.deepEqual(data.stores.map((s) => s.name), ["Beta", "Zeta"]);
        assert.deepEqual(data.contractors, ["K1", "K2", "K3"]);
    });

    it("filter status offline / unknown / online", () => {
        assert.deepEqual(buildDashboard(stores, now, { status: "offline" }).stores.map((s) => s.name), ["Alfa"]);
        assert.deepEqual(buildDashboard(stores, now, { status: "unknown" }).stores.map((s) => s.name), ["Gamma"]);
        assert.equal(buildDashboard(stores, now, { status: "online" }).stores.length, 2);
    });

    it("pencarian nama, kode toko, dan kontraktor (tanpa memperhatikan huruf besar)", () => {
        assert.deepEqual(buildDashboard(stores, now, { q: "alfa" }).stores.map((s) => s.name), ["Alfa"]);
        assert.deepEqual(buildDashboard(stores, now, { q: "code-beta" }).stores.map((s) => s.name), ["Beta"]);
        assert.deepEqual(buildDashboard(stores, now, { q: "k3" }).stores.map((s) => s.name), ["Gamma"]);
        assert.equal(buildDashboard(stores, now, { q: "tidak-ada" }).stores.length, 0);
    });
});

describe("toMinuteSegments", () => {
    const dayStart = new Date("2026-10-14T17:00:00Z"); // 00:00 WIB 15 Okt

    it("mengubah rentang menjadi menit sejak 00:00 WIB", () => {
        const segs = toMinuteSegments(
            [{ start: new Date("2026-10-15T02:00:00Z"), end: new Date("2026-10-15T03:30:00Z") }], // 09:00–10:30 WIB
            dayStart,
        );
        assert.deepEqual(segs, [{ startMin: 540, endMin: 630 }]);
    });

    it("memotong ke 0..1440 dan membuang segmen kosong", () => {
        const segs = toMinuteSegments(
            [
                { start: new Date("2026-10-14T16:00:00Z"), end: new Date("2026-10-14T18:00:00Z") }, // lewat tengah malam
                { start: new Date("2026-10-14T16:00:00Z"), end: new Date("2026-10-14T16:30:00Z") }, // hari sebelumnya
            ],
            dayStart,
        );
        assert.deepEqual(segs, [{ startMin: 0, endMin: 60 }]);
    });
});

describe("deriveConnectivity", () => {
    it("UNKNOWN: semua slot netral (tidak mengarang kegagalan)", () => {
        assert.ok(deriveConnectivity(cam("1", "UNKNOWN"), now).every((s) => s === "up"));
    });

    it("deterministik untuk kamera yang sama", () => {
        const c = cam("1", "UNSTABLE", "OK", { disconnectsToday: 4 });
        assert.deepEqual(deriveConnectivity(c, now), deriveConnectivity(c, now));
        assert.ok(deriveConnectivity(c, now).filter((s) => s === "down").length >= 1);
    });

    it("online tanpa putus → semua up", () => {
        assert.ok(deriveConnectivity(cam("1"), now).every((s) => s === "up"));
    });
});

describe("buildContractorLive", () => {
    const stores = [
        store("Toko B", "K1", [cam("CAM-02"), cam("CAM-01")]),
        store("Toko A", "K1", [cam("CAM-01", "OFFLINE")]),
        store("Toko C", "K2", [cam("CAM-01")]),
    ];
    it("menggabungkan kamera semua toko satu kontraktor, urut toko lalu label", () => {
        const view = buildContractorLive(stores, "id-K1");
        assert.equal(view?.contractor.name, "K1");
        assert.equal(view?.account?.id, "acc-K1");
        assert.deepEqual(
            view?.cameras.map((c) => `${c.storeName}:${c.label}`),
            ["Toko A:CAM-01", "Toko B:CAM-01", "Toko B:CAM-02"],
        );
    });
    it("null bila kontraktor tidak punya toko", () => {
        assert.equal(buildContractorLive(stores, "id-K9"), null);
    });
});

describe("pickLiveCameras", () => {
    const cameras = [cam("1", "OFFLINE"), cam("2"), cam("3", "UNSTABLE"), cam("4", "UNKNOWN"), cam("5")];
    it("hanya kamera online/tidak stabil, maksimal sebanyak batas", () => {
        assert.deepEqual(pickLiveCameras(cameras, 2), ["s:2", "s:3"]);
        assert.deepEqual(pickLiveCameras(cameras, 5), ["s:2", "s:3", "s:5"]);
        assert.deepEqual(pickLiveCameras(cameras, 0), []);
    });
});
