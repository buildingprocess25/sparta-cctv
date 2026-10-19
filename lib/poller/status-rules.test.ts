import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeUptime, countDisconnects, deriveStatus, rawOf, type RawStatus, type TimelineEvent } from "./status-rules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date("2026-10-15T08:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const ev = (status: RawStatus, msAgo: number): TimelineEvent => ({ status, at: ago(msAgo) });

describe("rawOf / deriveStatus", () => {
    it("UNSTABLE kembali ke ONLINE", () => {
        assert.equal(rawOf("UNSTABLE"), "ONLINE");
        assert.equal(rawOf("OFFLINE"), "OFFLINE");
        assert.equal(rawOf("UNKNOWN"), "UNKNOWN");
    });

    it("online + putus ≥ ambang → UNSTABLE", () => {
        assert.equal(deriveStatus("ONLINE", 2, 3), "ONLINE");
        assert.equal(deriveStatus("ONLINE", 3, 3), "UNSTABLE");
        assert.equal(deriveStatus("ONLINE", 9, 3), "UNSTABLE");
    });

    it("offline/unknown tidak pernah UNSTABLE", () => {
        assert.equal(deriveStatus("OFFLINE", 9, 3), "OFFLINE");
        assert.equal(deriveStatus("UNKNOWN", 9, 3), "UNKNOWN");
    });
});

describe("countDisconnects", () => {
    const dayStart = ago(10 * HOUR);

    it("menghitung transisi ONLINE → OFFLINE sejak awal hari", () => {
        const events = [ev("ONLINE", 20 * HOUR), ev("OFFLINE", 8 * HOUR), ev("ONLINE", 7 * HOUR), ev("OFFLINE", 2 * HOUR)];
        assert.equal(countDisconnects(events, dayStart), 2);
    });

    it("putus sebelum awal hari tidak dihitung, tetapi pendahulu dipakai", () => {
        const events = [ev("ONLINE", 20 * HOUR), ev("OFFLINE", 12 * HOUR), ev("ONLINE", 11 * HOUR)];
        assert.equal(countDisconnects(events, dayStart), 0);
        // event OFFLINE pertama setelah awal hari, pendahulunya ONLINE sebelum awal hari
        assert.equal(countDisconnects([ev("ONLINE", 20 * HOUR), ev("OFFLINE", 5 * HOUR)], dayStart), 1);
    });

    it("UNKNOWN → OFFLINE bukan putus", () => {
        assert.equal(countDisconnects([ev("UNKNOWN", 5 * HOUR), ev("OFFLINE", 4 * HOUR)], dayStart), 0);
    });

    it("tanpa event atau satu event → 0", () => {
        assert.equal(countDisconnects([], dayStart), 0);
        assert.equal(countDisconnects([ev("OFFLINE", HOUR)], dayStart), 0);
    });
});

describe("computeUptime", () => {
    it("tanpa data → null", () => {
        assert.equal(computeUptime([], now), null);
    });

    it("selalu online → 100", () => {
        assert.equal(computeUptime([ev("ONLINE", 3 * DAY)], now), 100);
    });

    it("offline 1 dari 4 hari → 75", () => {
        const events = [ev("ONLINE", 4 * DAY), ev("OFFLINE", 3 * DAY), ev("ONLINE", 2 * DAY)];
        assert.equal(computeUptime(events, now), 75);
    });

    it("jendela dibatasi 7 hari; event lama hanya memberi keadaan awal", () => {
        const events = [ev("OFFLINE", 30 * DAY), ev("ONLINE", 6 * DAY)]; // offline 1 hari di dalam jendela, lalu online
        // jendela: 7 hari lalu → 6 hari lalu OFFLINE (1 hari), sisanya 6 hari ONLINE
        assert.equal(computeUptime(events, now), Math.round((6 / 7) * 1000) / 10);
    });

    it("UNKNOWN tidak dihitung di pembilang maupun penyebut", () => {
        const events = [ev("UNKNOWN", 3 * DAY), ev("ONLINE", 2 * DAY), ev("OFFLINE", 1 * DAY)];
        assert.equal(computeUptime(events, now), 50);
    });

    it("hanya UNKNOWN → null (belum ada pengukuran)", () => {
        assert.equal(computeUptime([ev("UNKNOWN", 2 * DAY)], now), null);
    });

    it("event pertama baru saja terjadi → jendela sangat pendek tetap valid", () => {
        assert.equal(computeUptime([ev("ONLINE", 5 * 60_000)], now), 100);
    });

    it("sedang offline sejak lama → mendekati 0", () => {
        const events = [ev("ONLINE", 8 * DAY), ev("OFFLINE", 6 * DAY)];
        assert.equal(computeUptime(events, now), Math.round((1 / 7) * 1000) / 10);
    });
});
