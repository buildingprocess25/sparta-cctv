import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCronAuth } from "./cron-auth";

const req = (authorization?: string) =>
    new Request("http://localhost/api/cron/x", { headers: authorization ? { authorization } : {} });

describe("checkCronAuth", () => {
    it("secret benar → boleh lanjut", () => {
        assert.equal(checkCronAuth(req("Bearer rahasia-123"), "rahasia-123"), null);
    });

    it("tanpa header, secret salah, atau skema bukan Bearer → 401", async () => {
        for (const header of [undefined, "Bearer salah", "rahasia-123", "Basic rahasia-123", "Bearer "]) {
            const res = checkCronAuth(req(header), "rahasia-123");
            assert.equal(res?.status, 401, String(header));
        }
    });

    it("CRON_SECRET belum diset → 503 walau header apa pun (tidak pernah terbuka)", async () => {
        assert.equal(checkCronAuth(req("Bearer apa-saja"), undefined)?.status, 503);
        assert.equal(checkCronAuth(req("Bearer "), "")?.status, 503);
    });

    it("secret beda panjang tidak melempar error", () => {
        assert.equal(checkCronAuth(req("Bearer a"), "jauh-lebih-panjang-dari-itu")?.status, 401);
    });

    it("respons error berupa JSON tanpa membocorkan secret", async () => {
        const res = checkCronAuth(req("Bearer salah"), "rahasia-123")!;
        const text = await res.text();
        assert.ok(!text.includes("rahasia-123"));
        assert.match(res.headers.get("content-type") ?? "", /json/);
    });
});
