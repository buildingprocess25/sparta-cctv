import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatEzvizTime, parseEzvizTime, startOfDayWib } from "./time";

describe("waktu EZVIZ (WIB)", () => {
    it("format: UTC 08:00 → 15:00 WIB", () => {
        assert.equal(formatEzvizTime(new Date("2026-10-15T08:00:00Z")), "2026-10-15 15:00:00");
    });

    it("format melewati tengah malam WIB", () => {
        assert.equal(formatEzvizTime(new Date("2026-10-15T20:30:05Z")), "2026-10-16 03:30:05");
    });

    it("parse dengan spasi maupun huruf T", () => {
        assert.equal(parseEzvizTime("2026-10-15 15:00:00").toISOString(), "2026-10-15T08:00:00.000Z");
        assert.equal(parseEzvizTime("2026-10-15T15:00:00").toISOString(), "2026-10-15T08:00:00.000Z");
    });

    it("format lalu parse bolak-balik", () => {
        const d = new Date("2026-01-02T03:04:05Z");
        assert.equal(parseEzvizTime(formatEzvizTime(d)).toISOString(), d.toISOString());
    });

    it("menolak format tak dikenal", () => {
        assert.throws(() => parseEzvizTime("kemarin"), /Format waktu/);
    });

    it("startOfDayWib: 00:00 WIB hari yang sama", () => {
        assert.equal(startOfDayWib(new Date("2026-10-15T08:00:00Z")).toISOString(), "2026-10-14T17:00:00.000Z");
        // 23:30 UTC sudah hari berikutnya di WIB
        assert.equal(startOfDayWib(new Date("2026-10-14T23:30:00Z")).toISOString(), "2026-10-14T17:00:00.000Z");
    });
});
