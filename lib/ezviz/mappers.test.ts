import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapDeviceStatus, mapSdStatus } from "./mappers";

describe("mapDeviceStatus", () => {
    it("1 online, 0 offline, lainnya tidak diketahui", () => {
        assert.equal(mapDeviceStatus(1), "ONLINE");
        assert.equal(mapDeviceStatus(0), "OFFLINE");
        assert.equal(mapDeviceStatus(-1), "UNKNOWN");
        assert.equal(mapDeviceStatus(7), "UNKNOWN");
    });
});

describe("mapSdStatus", () => {
    const status = (diskNum: number, diskState: string) => ({ diskNum, diskState });

    it("tidak dilaporkan → null (pertahankan nilai terakhir)", () => {
        assert.equal(mapSdStatus(status(-1, "-1")), null);
        assert.equal(mapSdStatus(status(1, "-1")), null);
    });
    it("tanpa kartu SD → NONE", () => {
        assert.equal(mapSdStatus(status(0, "----------------")), "NONE");
    });
    it("0 normal, 2 belum diformat, 3 sedang format, 1 media salah", () => {
        assert.equal(mapSdStatus(status(1, "0---------------")), "OK");
        assert.equal(mapSdStatus(status(1, "2---------------")), "NOT_FORMATTED");
        assert.equal(mapSdStatus(status(1, "3---------------")), "NOT_FORMATTED");
        assert.equal(mapSdStatus(status(1, "1---------------")), "UNREADABLE");
    });
    it("beberapa disk: diambil yang terburuk, disk di luar diskNum diabaikan", () => {
        assert.equal(mapSdStatus(status(2, "02--------------")), "NOT_FORMATTED");
        assert.equal(mapSdStatus(status(2, "12--------------")), "UNREADABLE");
        assert.equal(mapSdStatus(status(1, "01--------------")), "OK");
    });
});
