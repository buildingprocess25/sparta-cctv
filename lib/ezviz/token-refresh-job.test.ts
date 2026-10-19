import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { encryptSecret } from "@/lib/crypto";
import { EzvizClient } from "./client";
import { MemoryAccountStore } from "./memory-account-store";
import { FakeEzvizServer } from "./testing/fake-server";
import { refreshDueTokens } from "./token-refresh-job";
import { TokenManager } from "./token-manager";

const key = randomBytes(32);
const HOUR = 3_600_000;
const server = new FakeEzvizServer();

let clock: number;
let store: MemoryAccountStore;
let tokens: TokenManager;

before(async () => {
    await server.start();
});
after(() => server.stop());

function add(id: string, status: "ACTIVE" | "TOKEN_ERROR" | "DISABLED", expiresInMs: number | null, secret = "secret-1") {
    store.add({
        id,
        appKey: "key-1",
        appSecretEnc: encryptSecret(secret, { key, aad: `${id}:appSecret` }),
        accessTokenEnc: null,
        tokenExpiresAt: expiresInMs === null ? null : new Date(clock + expiresInMs),
        areaDomain: expiresInMs === null ? null : server.baseUrl,
        status,
    });
}

const run = () => refreshDueTokens({ store, tokens, now: () => new Date(clock) });
const byId = (results: Awaited<ReturnType<typeof run>>) => Object.fromEntries(results.map((r) => [r.accountId, r]));

beforeEach(() => {
    clock = Date.now();
    server.credentials.clear();
    server.credentials.set("key-1", "secret-1");
    server.validTokens.clear();
    server.overrides.clear();
    server.requests.length = 0;
    server.tokenCalls = 0;
    store = new MemoryAccountStore(() => new Date(clock));
    tokens = new TokenManager({
        store,
        key,
        now: () => new Date(clock),
        client: new EzvizClient({ tokenBaseUrl: server.baseUrl, timeoutMs: 1000 }),
    });
});

describe("refreshDueTokens", () => {
    it("memperbarui token yang habis dalam ≤ 24 jam, melewati yang masih lama", async () => {
        add("hampir", "ACTIVE", 10 * HOUR);
        add("lama", "ACTIVE", 5 * 24 * HOUR);
        const r = byId(await run());
        assert.equal(r.hampir.action, "refreshed");
        assert.equal(r.lama.action, "skipped");
        assert.equal(server.tokenCalls, 1);
        assert.ok(store.accounts.get("hampir")!.accessTokenEnc);
    });

    it("akun tanpa token sama sekali dianggap jatuh tempo", async () => {
        add("baru", "ACTIVE", null);
        assert.equal(byId(await run()).baru.action, "refreshed");
    });

    it("akun DISABLED dilewati tanpa panggilan jaringan", async () => {
        add("mati", "DISABLED", null);
        assert.equal(byId(await run()).mati.action, "skipped");
        assert.equal(server.tokenCalls, 0);
    });

    it("TOKEN_ERROR: menunggu 6 jam, lalu dicoba ulang dan pulih bila kredensial sudah benar", async () => {
        add("rusak", "TOKEN_ERROR", null);
        await store.recordError("rusak", "kredensial salah", "TOKEN_ERROR");

        assert.equal(byId(await run()).rusak.action, "skipped");
        assert.equal(server.tokenCalls, 0);

        clock += 6 * HOUR + 1000;
        const r = byId(await run());
        assert.equal(r.rusak.action, "retried");
        assert.equal(store.accounts.get("rusak")!.status, "ACTIVE");
    });

    it("TOKEN_ERROR yang masih salah tetap gagal tanpa menghentikan akun lain", async () => {
        add("rusak", "TOKEN_ERROR", null, "secret-salah");
        add("sehat", "ACTIVE", 2 * HOUR);
        await store.recordError("rusak", "kredensial salah", "TOKEN_ERROR");
        clock += 7 * HOUR;

        const r = byId(await run());
        assert.equal(r.rusak.action, "failed");
        assert.ok(!r.rusak.error!.includes("secret-salah"));
        assert.equal(r.sehat.action, "refreshed");
        assert.equal(store.accounts.get("rusak")!.status, "TOKEN_ERROR");
    });

    it("gangguan sementara dilaporkan failed tetapi akun tetap ACTIVE", async () => {
        add("a", "ACTIVE", 2 * HOUR);
        server.overrides.set("/api/lapp/token/get", () => ({ body: { code: "49999", msg: "Data exception" } }));
        assert.equal(byId(await run()).a.action, "failed");
        assert.equal(store.accounts.get("a")!.status, "ACTIVE");
    });
});
