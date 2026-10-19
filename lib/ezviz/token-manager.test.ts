import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { encryptSecret } from "@/lib/crypto";
import { EzvizClient } from "./client";
import {
    AccountUnavailableError,
    CredentialError,
    TokenExpiredError,
    TransientError,
} from "./errors";
import { MemoryAccountStore } from "./memory-account-store";
import { FakeEzvizServer } from "./testing/fake-server";
import { TokenManager } from "./token-manager";

const key = randomBytes(32);
const server = new FakeEzvizServer();
const HOUR = 3_600_000;

let store: MemoryAccountStore;
let manager: TokenManager;
let clock: number;

before(async () => {
    await server.start();
});
after(() => server.stop());

function addAccount(id = "acc-1", appSecret = "secret-1", status: "ACTIVE" | "TOKEN_ERROR" | "DISABLED" = "ACTIVE") {
    store.add({
        id,
        appKey: "key-1",
        appSecretEnc: encryptSecret(appSecret, { key, aad: `${id}:appSecret` }),
        accessTokenEnc: null,
        tokenExpiresAt: null,
        areaDomain: null,
        status,
    });
}

beforeEach(() => {
    server.credentials.clear();
    server.credentials.set("key-1", "secret-1");
    server.validTokens.clear();
    server.overrides.clear();
    server.requests.length = 0;
    server.tokenCalls = 0;
    server.tokenDelayMs = 0;
    server.tokenLifetimeMs = 7 * 24 * HOUR;
    server.invalidateOldTokens = false;

    store = new MemoryAccountStore();
    clock = Date.now();
    manager = new TokenManager({
        store,
        key,
        now: () => new Date(clock),
        client: new EzvizClient({ tokenBaseUrl: server.baseUrl, timeoutMs: 1000 }),
    });
    addAccount();
});

describe("TokenManager.getValidToken", () => {
    it("meminta token saat pertama kali dan menyimpannya terenkripsi", async () => {
        const ctx = await manager.getValidToken("acc-1");
        assert.match(ctx.accessToken, /^at\.fake-/);
        assert.equal(ctx.areaDomain, server.baseUrl);

        const saved = store.accounts.get("acc-1")!;
        assert.ok(saved.accessTokenEnc?.startsWith("v1:"));
        assert.ok(!saved.accessTokenEnc!.includes(ctx.accessToken));
        assert.equal(saved.areaDomain, server.baseUrl);
        assert.equal(saved.status, "ACTIVE");
        assert.equal(server.tokenCalls, 1);
    });

    it("memakai ulang token yang masih jauh dari kedaluwarsa", async () => {
        const a = await manager.getValidToken("acc-1");
        const b = await manager.getValidToken("acc-1");
        assert.equal(a.accessToken, b.accessToken);
        assert.equal(server.tokenCalls, 1);
    });

    it("memperbarui token yang sisa umurnya < 12 jam", async () => {
        const a = await manager.getValidToken("acc-1");
        clock += 7 * 24 * HOUR - 6 * HOUR; // sisa 6 jam
        const b = await manager.getValidToken("acc-1");
        assert.notEqual(a.accessToken, b.accessToken);
        assert.equal(server.tokenCalls, 2);
    });

    it("lima permintaan bersamaan hanya memicu satu panggilan token/get", async () => {
        server.tokenDelayMs = 50;
        const results = await Promise.all(Array.from({ length: 5 }, () => manager.getValidToken("acc-1")));
        assert.equal(server.tokenCalls, 1);
        assert.equal(new Set(results.map((r) => r.accessToken)).size, 1);
    });

    it("refresh dini gagal sementara tetapi token lama masih berlaku → token lama dipakai", async () => {
        const a = await manager.getValidToken("acc-1");
        clock += 7 * 24 * HOUR - 6 * HOUR;
        server.overrides.set("/api/lapp/token/get", () => ({ body: { code: "49999", msg: "Data exception" } }));
        const b = await manager.getValidToken("acc-1");
        assert.equal(b.accessToken, a.accessToken);
        assert.equal(store.accounts.get("acc-1")!.status, "ACTIVE"); // gangguan sementara tidak menandai akun
        assert.ok(store.accounts.get("acc-1")!.lastError);
    });

    it("token sudah habis dan refresh gagal sementara → error (akun tetap ACTIVE)", async () => {
        await manager.getValidToken("acc-1");
        clock += 8 * 24 * HOUR;
        server.overrides.set("/api/lapp/token/get", () => ({ body: { code: "49999", msg: "Data exception" } }));
        await assert.rejects(manager.getValidToken("acc-1"), TransientError);
        assert.equal(store.accounts.get("acc-1")!.status, "ACTIVE");
    });

    it("kredensial salah → CredentialError, akun TOKEN_ERROR, pemanggilan berikutnya tidak menyentuh server", async () => {
        server.credentials.set("key-1", "secret-baru"); // kontraktor mengganti secret
        await assert.rejects(manager.getValidToken("acc-1"), CredentialError);
        assert.equal(store.accounts.get("acc-1")!.status, "TOKEN_ERROR");
        assert.match(store.accounts.get("acc-1")!.lastError ?? "", /10030/);

        const callsBefore = server.tokenCalls;
        await assert.rejects(manager.getValidToken("acc-1"), (e: Error) => {
            assert.ok(e instanceof AccountUnavailableError);
            assert.equal((e as AccountUnavailableError).reason, "TOKEN_ERROR");
            return true;
        });
        assert.equal(server.tokenCalls, callsBefore);
    });

    it("akun DISABLED dan tidak ada → AccountUnavailableError tanpa panggilan jaringan", async () => {
        addAccount("acc-off", "secret-1", "DISABLED");
        await assert.rejects(manager.getValidToken("acc-off"), /dinonaktifkan/);
        await assert.rejects(manager.getValidToken("tidak-ada"), (e: Error) => {
            assert.equal((e as AccountUnavailableError).reason, "NOT_FOUND");
            return true;
        });
        assert.equal(server.tokenCalls, 0);
    });

    it("pesan error tidak memuat appSecret", async () => {
        server.credentials.set("key-1", "secret-baru");
        await assert.rejects(manager.getValidToken("acc-1"), (e: Error) => {
            assert.ok(!e.message.includes("secret-1"));
            return true;
        });
        assert.ok(!(store.accounts.get("acc-1")!.lastError ?? "").includes("secret-1"));
    });
});

describe("TokenManager.refresh (force)", () => {
    it("force memulihkan akun TOKEN_ERROR setelah kredensial diperbaiki", async () => {
        server.credentials.set("key-1", "secret-baru");
        await assert.rejects(manager.getValidToken("acc-1"), CredentialError);

        // Admin memasukkan secret yang benar.
        store.accounts.get("acc-1")!.appSecretEnc = encryptSecret("secret-baru", { key, aad: "acc-1:appSecret" });
        const ctx = await manager.refresh("acc-1", { force: true });
        assert.match(ctx.accessToken, /^at\.fake-/);
        assert.equal(store.accounts.get("acc-1")!.status, "ACTIVE");
        assert.equal(store.accounts.get("acc-1")!.lastError, null);
    });

    it("force tidak membuka akun DISABLED", async () => {
        addAccount("acc-off", "secret-1", "DISABLED");
        await assert.rejects(manager.refresh("acc-off", { force: true }), AccountUnavailableError);
    });

    it("force selalu meminta token baru walau yang lama masih valid", async () => {
        await manager.getValidToken("acc-1");
        await manager.refresh("acc-1", { force: true });
        assert.equal(server.tokenCalls, 2);
    });
});

describe("TokenManager.withToken", () => {
    it("10002 → refresh sekali lalu ulangi permintaan", async () => {
        const first = await manager.getValidToken("acc-1");
        server.expireAllTokens(); // EZVIZ menolak token lama

        const seen: string[] = [];
        const result = await manager.withToken("acc-1", async (ctx) => {
            seen.push(ctx.accessToken);
            if (!server.validTokens.has(ctx.accessToken)) throw new TokenExpiredError("10002", 10002);
            return "ok";
        });

        assert.equal(result, "ok");
        assert.equal(seen.length, 2);
        assert.equal(seen[0], first.accessToken);
        assert.notEqual(seen[1], first.accessToken);
        assert.equal(server.tokenCalls, 2);
    });

    it("tetap 10002 setelah refresh → error diteruskan (tidak berulang tanpa batas)", async () => {
        let calls = 0;
        await assert.rejects(
            manager.withToken("acc-1", async () => {
                calls++;
                throw new TokenExpiredError("10002", 10002);
            }),
            TokenExpiredError,
        );
        assert.equal(calls, 2);
        assert.equal(server.tokenCalls, 2);
    });

    it("error selain 10002 diteruskan tanpa refresh", async () => {
        await assert.rejects(
            manager.withToken("acc-1", async () => {
                throw new TransientError("gangguan");
            }),
            TransientError,
        );
        assert.equal(server.tokenCalls, 1);
    });

    it("banyak permintaan bersamaan yang kena 10002 hanya memicu satu refresh", async () => {
        const first = await manager.getValidToken("acc-1");
        server.expireAllTokens();
        server.tokenDelayMs = 30;

        const results = await Promise.all(
            Array.from({ length: 6 }, (_, i) =>
                manager.withToken("acc-1", async (ctx) => {
                    if (!server.validTokens.has(ctx.accessToken)) throw new TokenExpiredError("10002", 10002);
                    return `${i}:${ctx.accessToken}`;
                }),
            ),
        );

        assert.equal(results.length, 6);
        assert.equal(server.tokenCalls, 2); // 1 awal + 1 refresh bersama
        const tokens = new Set(results.map((r) => r.split(":")[1]));
        assert.equal(tokens.size, 1);
        assert.ok(!tokens.has(first.accessToken));
    });

    it("token tersimpan rusak (key rotasi) → diminta ulang, bukan crash", async () => {
        await manager.getValidToken("acc-1");
        store.accounts.get("acc-1")!.accessTokenEnc = "v1:AAAA:AAAA:AAAA";
        const ctx = await manager.getValidToken("acc-1");
        assert.match(ctx.accessToken, /^at\.fake-/);
        assert.equal(server.tokenCalls, 2);
    });
});
