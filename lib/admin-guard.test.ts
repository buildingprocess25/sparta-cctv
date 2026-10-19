import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adminUiStatus } from "./admin-guard";

describe("adminUiStatus", () => {
    it("nonaktif secara bawaan dan untuk nilai selain 'true'", () => {
        assert.equal(adminUiStatus({}), "disabled");
        for (const v of ["", "false", "1", "TRUE", "yes"]) {
            assert.equal(adminUiStatus({ ADMIN_UI_ENABLED: v, CAMERA_DATA_SOURCE: "db" }), "disabled", v);
        }
    });

    it("aktif tetapi butuh database bila mode mock / tidak diset", () => {
        assert.equal(adminUiStatus({ ADMIN_UI_ENABLED: "true" }), "needs-db");
        assert.equal(adminUiStatus({ ADMIN_UI_ENABLED: "true", CAMERA_DATA_SOURCE: "mock" }), "needs-db");
    });

    it("siap pada mode db atau ezviz", () => {
        assert.equal(adminUiStatus({ ADMIN_UI_ENABLED: "true", CAMERA_DATA_SOURCE: "db" }), "ready");
        assert.equal(adminUiStatus({ ADMIN_UI_ENABLED: "true", CAMERA_DATA_SOURCE: "ezviz" }), "ready");
    });
});
