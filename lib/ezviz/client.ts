import { classifyError, EzvizError, TransientError } from "./errors";
import type {
    EzvizDevice,
    EzvizDeviceInfo,
    EzvizDeviceStatus,
    EzvizToken,
    LiveAddress,
    LiveAddressRequest,
    LocalRecordSegment,
} from "./types";

// Klien HTTP tipis untuk EZVIZ Open Platform. Lihat docs/ezviz-api-notes.md.
// Tidak melakukan retry dan tidak mengurus token — itu tugas lapisan di atasnya.

export type EzvizClientOptions = {
    /** host untuk token/get, mis. https://open.ezvizlife.com */
    tokenBaseUrl: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
};

type Envelope = {
    code?: string | number;
    msg?: string;
    meta?: { code?: number; message?: string };
    data?: unknown;
};

type Params = Record<string, string | number | boolean | undefined>;

const PAGE_SIZE = 50;

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : v == null ? fallback : String(v));
const num = (v: unknown, fallback = 0) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
};

export class EzvizClient {
    private readonly tokenBaseUrl: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(options: EzvizClientOptions) {
        this.tokenBaseUrl = options.tokenBaseUrl;
        this.timeoutMs = options.timeoutMs ?? 15_000;
        this.fetchImpl = options.fetch ?? fetch;
    }

    // ---- transport -------------------------------------------------------

    private async request(
        baseUrl: string,
        path: string,
        init: { method: "GET" | "POST"; form?: Params; query?: Params; headers?: Record<string, string> },
    ): Promise<unknown> {
        const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
        for (const [k, v] of Object.entries(init.query ?? {})) {
            if (v !== undefined) url.searchParams.set(k, String(v));
        }

        const headers: Record<string, string> = { ...init.headers };
        let body: string | undefined;
        if (init.method === "POST") {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            const form = new URLSearchParams();
            for (const [k, v] of Object.entries(init.form ?? {})) {
                if (v !== undefined) form.set(k, String(v));
            }
            body = form.toString();
        }

        let res: Response;
        let text: string;
        try {
            res = await this.fetchImpl(url, {
                method: init.method,
                headers,
                body,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            text = await res.text();
        } catch (cause) {
            // Sengaja tidak menyertakan URL/body (mengandung token).
            const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
            throw new TransientError(
                `EZVIZ ${path}: ${timedOut ? "timeout" : "gagal terhubung"}`,
                null,
                { cause },
            );
        }

        let json: Envelope;
        try {
            json = JSON.parse(text) as Envelope;
        } catch {
            throw new TransientError(`EZVIZ ${path}: respons bukan JSON (HTTP ${res.status})`, null);
        }

        // Dua bentuk respons: { code: "200", msg } dan v3 { meta: { code: 200, message } }.
        const rawCode = json.meta?.code ?? json.code;
        const code = rawCode === undefined ? (res.status === 401 ? 10002 : res.status) : Number(rawCode);
        if (code !== 200) {
            throw classifyError(code, json.msg ?? json.meta?.message ?? "", path);
        }
        return json.data;
    }

    private post(areaDomain: string, path: string, form: Params) {
        return this.request(areaDomain, path, { method: "POST", form });
    }

    // ---- token -----------------------------------------------------------

    async getToken(appKey: string, appSecret: string): Promise<EzvizToken> {
        const data = asRecord(
            await this.request(this.tokenBaseUrl, "/api/lapp/token/get", {
                method: "POST",
                form: { appKey, appSecret },
            }),
        );
        const accessToken = str(data.accessToken);
        const areaDomain = str(data.areaDomain);
        const expireTime = num(data.expireTime, NaN);
        if (!accessToken || !areaDomain || Number.isNaN(expireTime)) {
            throw new EzvizError("EZVIZ /api/lapp/token/get: respons tidak lengkap");
        }
        return { accessToken, areaDomain, expiresAt: new Date(expireTime) };
    }

    // ---- perangkat -------------------------------------------------------

    /** Semua perangkat akun (menelusuri halaman; 1 panggilan untuk ≤ 50 perangkat). */
    async listDevices(areaDomain: string, accessToken: string): Promise<EzvizDevice[]> {
        const devices: EzvizDevice[] = [];
        for (let page = 0; ; page++) {
            const raw = (await this.post(areaDomain, "/api/lapp/device/list", {
                accessToken,
                pageStart: page,
                pageSize: PAGE_SIZE,
            })) as unknown;
            const rows = Array.isArray(raw) ? raw : [];
            for (const row of rows) {
                const r = asRecord(row);
                devices.push({
                    deviceSerial: str(r.deviceSerial),
                    deviceName: str(r.deviceName),
                    deviceType: str(r.deviceType),
                    status: num(r.status, -1),
                    isEncrypt: num(r.isEncrypt) === 1,
                    deviceVersion: r.deviceVersion == null ? null : str(r.deviceVersion),
                });
            }
            if (rows.length < PAGE_SIZE) break;
        }
        return devices;
    }

    async getDeviceInfo(areaDomain: string, accessToken: string, deviceSerial: string): Promise<EzvizDeviceInfo> {
        const r = asRecord(await this.post(areaDomain, "/api/lapp/device/info", { accessToken, deviceSerial }));
        return {
            deviceSerial: str(r.deviceSerial, deviceSerial),
            deviceName: str(r.deviceName),
            model: str(r.model),
            status: num(r.status, -1),
            isEncrypt: num(r.isEncrypt) === 1,
        };
    }

    async getDeviceStatus(
        areaDomain: string,
        accessToken: string,
        deviceSerial: string,
        channel = 1,
    ): Promise<EzvizDeviceStatus> {
        const r = asRecord(
            await this.post(areaDomain, "/api/lapp/device/status/get", { accessToken, deviceSerial, channel }),
        );
        return { diskNum: num(r.diskNum, -1), diskState: str(r.diskState, "-1") };
    }

    // ---- snapshot --------------------------------------------------------

    /** Mengembalikan URL gambar sementara; unduh dan simpan di server. */
    async captureSnapshot(
        areaDomain: string,
        accessToken: string,
        deviceSerial: string,
        channelNo = 1,
        quality?: 0 | 1 | 2 | 3 | 4,
    ): Promise<string> {
        const r = asRecord(
            await this.post(areaDomain, "/api/lapp/device/capture", { accessToken, deviceSerial, channelNo, quality }),
        );
        const picUrl = str(r.picUrl);
        if (!picUrl) throw new EzvizError("EZVIZ /api/lapp/device/capture: picUrl kosong");
        return picUrl;
    }

    // ---- live / playback -------------------------------------------------

    async getLiveAddress(areaDomain: string, accessToken: string, req: LiveAddressRequest): Promise<LiveAddress> {
        const r = asRecord(await this.post(areaDomain, "/api/lapp/live/address/get", { accessToken, ...req }));
        const url = str(r.url);
        if (!url) throw new EzvizError("EZVIZ /api/lapp/live/address/get: url kosong");
        return { id: str(r.id), url, expireTime: str(r.expireTime) };
    }

    async disableLiveAddress(
        areaDomain: string,
        accessToken: string,
        deviceSerial: string,
        urlId: string,
        channelNo = 1,
    ): Promise<void> {
        await this.post(areaDomain, "/api/lapp/live/address/disable", { accessToken, deviceSerial, channelNo, urlId });
    }

    // ---- rekaman MicroSD -------------------------------------------------

    /** startTime/endTime: "yyyy-MM-dd HH:mm:ss". GET; token dan serial di header. */
    async queryLocalRecords(
        areaDomain: string,
        accessToken: string,
        deviceSerial: string,
        range: { startTime?: string; endTime?: string; channelNo?: number; recordType?: 1 | 2 | 3 | 4 } = {},
    ): Promise<LocalRecordSegment[]> {
        const raw = await this.request(areaDomain, "/api/v3/das/device/local/video/query", {
            method: "GET",
            headers: {
                accessToken,
                deviceSerial,
                ...(range.channelNo !== undefined ? { channelNo: String(range.channelNo) } : {}),
            },
            query: { startTime: range.startTime, endTime: range.endTime, recordType: range.recordType },
        });
        const rows = Array.isArray(raw) ? raw : [];
        return rows.map((row) => {
            const r = asRecord(row);
            return {
                startTime: str(r.startTime),
                endTime: str(r.endTime),
                deviceSerial: str(r.deviceSerial, deviceSerial),
                channelNo: str(r.cameraNo, "1"),
                type: str(r.type),
            };
        });
    }
}
