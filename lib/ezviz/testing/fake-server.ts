import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Server EZVIZ palsu untuk tes: meniru bentuk respons dokumentasi resmi
// (docs/ezviz-api-notes.md), termasuk token kedaluwarsa dan kode error.

export type RecordedRequest = {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
    form: Record<string, string>;
};

export type FakeResponse = {
    status?: number;
    body: unknown;
    /** balasan biner (mis. gambar) menggantikan body JSON */
    raw?: { contentType: string; bytes: Uint8Array };
};
export type FakeHandler = (req: RecordedRequest) => FakeResponse | Promise<FakeResponse>;

export class FakeEzvizServer {
    readonly credentials = new Map<string, string>(); // appKey → appSecret
    readonly validTokens = new Set<string>();
    readonly requests: RecordedRequest[] = [];
    readonly overrides = new Map<string, FakeHandler>();

    devices: Record<string, unknown>[] = [];
    tokenLifetimeMs = 7 * 24 * 3_600_000;
    tokenDelayMs = 0;
    /** bila true, token baru membatalkan semua token lama */
    invalidateOldTokens = false;
    tokenCalls = 0;

    private tokenSeq = 0;
    private server?: Server;
    baseUrl = "";

    async start() {
        this.server = createServer((req, res) => {
            void this.handle(req).then((out) => {
                res.statusCode = out.status ?? 200;
                if (out.raw) {
                    res.setHeader("Content-Type", out.raw.contentType);
                    res.end(Buffer.from(out.raw.bytes));
                    return;
                }
                res.setHeader("Content-Type", "application/json");
                res.end(typeof out.body === "string" ? out.body : JSON.stringify(out.body));
            });
        });
        await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
        this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
        return this;
    }

    async stop() {
        this.server?.closeAllConnections();
        await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }

    /** Anggap semua token yang pernah diterbitkan sudah kedaluwarsa di sisi EZVIZ. */
    expireAllTokens() {
        this.validTokens.clear();
    }

    callsTo(path: string) {
        return this.requests.filter((r) => r.path === path);
    }

    private async readForm(req: IncomingMessage) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    }

    private ok(data?: unknown): FakeResponse {
        return { body: { code: "200", msg: "Operation succeeded", ...(data !== undefined ? { data } : {}) } };
    }

    private error(code: number, msg: string): FakeResponse {
        return { body: { code: String(code), msg } };
    }

    private async handle(req: IncomingMessage): Promise<FakeResponse> {
        const url = new URL(req.url ?? "/", "http://fake");
        const record: RecordedRequest = {
            method: req.method ?? "GET",
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            headers: req.headers,
            form: req.method === "POST" ? await this.readForm(req) : {},
        };
        this.requests.push(record);

        const override = this.overrides.get(record.path);
        if (override) return override(record);

        if (record.path === "/api/lapp/token/get") return this.token(record);

        // gambar hasil capture (tanpa autentikasi, seperti img.ys7.com)
        if (record.path === "/img/pic.jpg") {
            return { body: null, raw: { contentType: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) } };
        }

        // v3 memakai token di header dan membalas HTTP 401 saat token tidak valid.
        if (record.path.startsWith("/api/v3/")) {
            const token = String(record.headers.accesstoken ?? "");
            if (!this.validTokens.has(token)) {
                return { status: 401, body: { meta: { code: 10002, message: "accessToken exception or expired" } } };
            }
            return { body: { meta: { code: 200, message: "ok", moreInfo: null }, data: [] } };
        }

        if (!this.validTokens.has(record.form.accessToken ?? "")) {
            return this.error(10002, "accessToken exception or expired");
        }

        switch (record.path) {
            case "/api/lapp/device/list": {
                const start = Number(record.form.pageStart ?? 0);
                const size = Number(record.form.pageSize ?? 10);
                const rows = this.devices.slice(start * size, start * size + size);
                return {
                    body: {
                        page: { total: this.devices.length, page: start, size },
                        data: rows,
                        code: "200",
                        msg: "Operating succeeded!",
                    },
                };
            }
            case "/api/lapp/device/info":
                return this.ok({ deviceSerial: record.form.deviceSerial, deviceName: "Cam", model: "CS-H8c", status: 1, isEncrypt: 0 });
            case "/api/lapp/device/status/get":
                return this.ok({ diskNum: 1, diskState: "0---------------" });
            case "/api/lapp/device/capture":
                return this.ok({ picUrl: `${this.baseUrl}/img/pic.jpg` });
            case "/api/lapp/live/address/get":
                return this.ok({
                    id: "live-1",
                    url: `${this.baseUrl}/v3/openlive/${record.form.deviceSerial}_1_1.m3u8`,
                    expireTime: "2026-10-15 15:00:00",
                });
            case "/api/lapp/live/address/disable":
            case "/api/lapp/device/ptz/start":
            case "/api/lapp/device/ptz/stop":
                return this.ok();
            default:
                return this.error(49999, "Data exception");
        }
    }

    private async token(req: RecordedRequest): Promise<FakeResponse> {
        this.tokenCalls++;
        if (this.tokenDelayMs) await new Promise((r) => setTimeout(r, this.tokenDelayMs));
        const { appKey = "", appSecret = "" } = req.form;
        if (!this.credentials.has(appKey)) return this.error(10017, "appKey does not exist");
        if (this.credentials.get(appKey) !== appSecret) return this.error(10030, "appkey and appSecret mismatched");

        if (this.invalidateOldTokens) this.validTokens.clear();
        const accessToken = `at.fake-${++this.tokenSeq}`;
        this.validTokens.add(accessToken);
        return this.ok({
            accessToken,
            expireTime: Date.now() + this.tokenLifetimeMs,
            areaDomain: this.baseUrl,
        });
    }
}
