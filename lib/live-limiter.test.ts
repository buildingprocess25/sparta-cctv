import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCapacity, isActive, maxLiveSessions, type LiveSessionLike } from "./live-limiter";

const now = new Date("2026-10-18T10:00:00Z");
const session = (over: Partial<LiveSessionLike>): LiveSessionLike => ({
    id: "s1",
    cameraId: "cam-a",
    expiresAt: new Date(now.getTime() + 60_000),
    endedAt: null,
    quality: 2,
    ...over,
});
const sd = { max: 2, quality: 2 } as const;

describe("live limiter", () => {
    it("mengizinkan sampai batas sesi akun", () => {
        assert.equal(checkCapacity([session({})], "cam-b", now, sd), null);
    });
    it("menolak bila slot akun penuh", () => {
        const open = [session({}), session({ id: "s2", cameraId: "cam-b" })];
        assert.equal(checkCapacity(open, "cam-c", now, sd), "full");
        assert.equal(checkCapacity([session({})], "cam-b", now, { max: 1, quality: 2 }), "full");
    });
    it("mengizinkan kamera yang sama (sesi dipakai ulang)", () => {
        const open = [session({}), session({ id: "s2", cameraId: "cam-b" })];
        assert.equal(checkCapacity(open, "cam-a", now, sd), null);
    });
    it("mengabaikan sesi kedaluwarsa atau sudah berakhir", () => {
        assert.equal(checkCapacity([session({ expiresAt: new Date(now.getTime() - 1) })], "cam-b", now, { max: 1, quality: 2 }), null);
        assert.equal(checkCapacity([session({ endedAt: now })], "cam-b", now, { max: 1, quality: 2 }), null);
    });
    it("HD hanya boleh bila tidak ada kamera lain yang live", () => {
        assert.equal(checkCapacity([], "cam-a", now, { max: 2, quality: 1 }), null);
        assert.equal(checkCapacity([session({ cameraId: "cam-a" })], "cam-a", now, { max: 2, quality: 1 }), null);
        assert.equal(checkCapacity([session({})], "cam-b", now, { max: 2, quality: 1 }), "hd_busy");
    });
    it("menolak sesi baru selama kamera lain live HD", () => {
        assert.equal(checkCapacity([session({ quality: 1 })], "cam-b", now, sd), "hd_busy");
    });
    it("isActive false tepat saat kedaluwarsa", () => {
        assert.equal(isActive(session({ expiresAt: now }), now), false);
    });
    it("batas sesi dari env, minimal 1", () => {
        assert.equal(maxLiveSessions({}), 2);
        assert.equal(maxLiveSessions({ LIVE_MAX_SESSIONS_PER_ACCOUNT: "3" }), 3);
        assert.equal(maxLiveSessions({ LIVE_MAX_SESSIONS_PER_ACCOUNT: "0" }), 2);
        assert.equal(maxLiveSessions({ LIVE_MAX_SESSIONS_PER_ACCOUNT: "x" }), 2);
    });
});

import { liveSecondsOf } from "./live-usage";

describe("liveSecondsOf", () => {
    const startedAt = new Date("2026-10-18T10:00:00Z");
    const expiresAt = new Date("2026-10-18T10:03:00Z");
    it("menghitung sampai waktu berakhir", () => {
        assert.equal(liveSecondsOf({ startedAt, expiresAt }, new Date("2026-10-18T10:01:30Z")), 90);
    });
    it("dibatasi kedaluwarsa", () => {
        assert.equal(liveSecondsOf({ startedAt, expiresAt }, new Date("2026-10-18T11:00:00Z")), 180);
    });
    it("tidak negatif", () => {
        assert.equal(liveSecondsOf({ startedAt, expiresAt }, new Date("2026-10-18T09:00:00Z")), 0);
    });
});
