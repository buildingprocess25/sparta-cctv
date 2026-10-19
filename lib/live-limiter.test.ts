import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findConflict, isActive, type LiveSessionLike } from "./live-limiter";

const now = new Date("2026-10-18T10:00:00Z");
const session = (over: Partial<LiveSessionLike>): LiveSessionLike => ({
    id: "s1",
    cameraId: "cam-a",
    expiresAt: new Date(now.getTime() + 60_000),
    endedAt: null,
    ...over,
});

describe("live limiter", () => {
    it("menolak kamera lain bila sudah ada sesi aktif", () => {
        assert.equal(findConflict([session({})], "cam-b", now)?.id, "s1");
    });
    it("mengizinkan kamera yang sama (sesi dipakai ulang)", () => {
        assert.equal(findConflict([session({})], "cam-a", now), null);
    });
    it("mengabaikan sesi kedaluwarsa atau sudah berakhir", () => {
        assert.equal(findConflict([session({ expiresAt: new Date(now.getTime() - 1) })], "cam-b", now), null);
        assert.equal(findConflict([session({ endedAt: now })], "cam-b", now), null);
    });
    it("isActive false tepat saat kedaluwarsa", () => {
        assert.equal(isActive(session({ expiresAt: now }), now), false);
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
