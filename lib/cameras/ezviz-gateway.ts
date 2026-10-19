import { EzvizClient } from "@/lib/ezviz/client";
import {
    AccountUnavailableError,
    CredentialError,
    DeviceNotFoundError,
    DeviceOfflineError,
    EzvizError,
    PtzLimitError,
    RateLimitError,
    TokenExpiredError,
    UnsupportedError,
} from "@/lib/ezviz/errors";
import { mapDeviceStatus, mapSdStatus, type SdStatusValue } from "@/lib/ezviz/mappers";
import { formatEzvizTime, parseEzvizTime } from "@/lib/ezviz/time";
import type { TokenManager } from "@/lib/ezviz/token-manager";
import { GatewayError, isGatewayError } from "./errors";
import type {
    CameraGateway,
    DeviceCheck,
    DeviceRef,
    LiveStream,
    PlayerAccess,
    PtzCommand,
    PtzMove,
    RecordingRange,
    SnapshotImage,
    StartLiveOptions,
} from "./gateway";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PTZ_DIRECTION = { up: 0, down: 1, left: 2, right: 3 } as const satisfies Record<PtzMove, number>;

export type EzvizGatewayDeps = {
    client: EzvizClient;
    tokens: TokenManager;
    fetch?: typeof fetch;
    now?: () => Date;
};

type Resolved = { accountId: string; deviceSerial: string; channelNo: number };

function resolve(ref: DeviceRef): Resolved {
    if (!ref.accountId) throw new GatewayError("account_unavailable", "Kontraktor belum punya akun EZVIZ");
    if (!ref.deviceSerial) throw new GatewayError("not_found", "Serial perangkat belum diisi");
    return { accountId: ref.accountId, deviceSerial: ref.deviceSerial, channelNo: ref.channelNo };
}

function toGatewayError(error: unknown): GatewayError {
    if (isGatewayError(error)) return error;
    const message = error instanceof Error ? error.message : "Kesalahan tidak dikenal";
    const options = { cause: error };
    if (error instanceof DeviceOfflineError) return new GatewayError("offline", message, options);
    if (error instanceof DeviceNotFoundError) return new GatewayError("not_found", message, options);
    if (error instanceof UnsupportedError) return new GatewayError("unsupported", message, options);
    if (error instanceof PtzLimitError) return new GatewayError("ptz_limit", message, options);
    if (error instanceof RateLimitError) return new GatewayError("rate_limited", message, options);
    if (
        error instanceof AccountUnavailableError ||
        error instanceof CredentialError ||
        error instanceof TokenExpiredError // masih ditolak setelah refresh
    ) {
        return new GatewayError("account_unavailable", message, options);
    }
    // EzvizError lain (termasuk TransientError) dan kegagalan tak terduga.
    return new GatewayError("transient", error instanceof EzvizError ? message : "Gangguan tak terduga", options);
}

export class EzvizGateway implements CameraGateway {
    readonly kind = "ezviz" as const;

    private readonly client: EzvizClient;
    private readonly tokens: TokenManager;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => Date;

    constructor(deps: EzvizGatewayDeps) {
        this.client = deps.client;
        this.tokens = deps.tokens;
        this.fetchImpl = deps.fetch ?? fetch;
        this.now = deps.now ?? (() => new Date());
    }

    private async call<T>(
        accountId: string,
        fn: (ctx: { accessToken: string; areaDomain: string }) => Promise<T>,
    ): Promise<T> {
        try {
            return await this.tokens.withToken(accountId, fn);
        } catch (error) {
            throw toGatewayError(error);
        }
    }

    async checkAccountDevices(accountId: string): Promise<DeviceCheck[]> {
        return this.call(accountId, async ({ accessToken, areaDomain }) => {
            const devices = await this.client.listDevices(areaDomain, accessToken);
            return devices.map((d) => ({
                deviceSerial: d.deviceSerial,
                connection: mapDeviceStatus(d.status),
                deviceType: d.deviceType,
                encrypted: d.isEncrypt,
            }));
        });
    }

    async getSdStatus(ref: DeviceRef): Promise<SdStatusValue | null> {
        const r = resolve(ref);
        return this.call(r.accountId, async ({ accessToken, areaDomain }) =>
            mapSdStatus(await this.client.getDeviceStatus(areaDomain, accessToken, r.deviceSerial, r.channelNo)),
        );
    }

    async captureSnapshot(ref: DeviceRef, options: { quality?: 0 | 1 | 2 | 3 | 4 } = {}): Promise<SnapshotImage> {
        const r = resolve(ref);
        const picUrl = await this.call(r.accountId, ({ accessToken, areaDomain }) =>
            this.client.captureSnapshot(areaDomain, accessToken, r.deviceSerial, r.channelNo, options.quality),
        );

        // picUrl bersifat sementara dan sering http → unduh di server, jangan dikirim ke browser.
        try {
            const res = await this.fetchImpl(picUrl, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) throw new GatewayError("transient", `Unduh snapshot gagal (HTTP ${res.status})`);
            const contentType = res.headers.get("content-type") ?? "";
            if (!contentType.startsWith("image/")) throw new GatewayError("transient", "Snapshot bukan gambar");
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
                throw new GatewayError("transient", "Ukuran snapshot tidak wajar");
            }
            return { bytes, contentType };
        } catch (error) {
            throw isGatewayError(error) ? error : new GatewayError("transient", "Unduh snapshot gagal", { cause: error });
        }
    }

    async startLive(ref: DeviceRef, options: StartLiveOptions): Promise<LiveStream> {
        const r = resolve(ref);
        const live = await this.call(r.accountId, ({ accessToken, areaDomain }) =>
            this.client.getLiveAddress(areaDomain, accessToken, {
                deviceSerial: r.deviceSerial,
                channelNo: r.channelNo,
                protocol: 2, // HLS: bisa diputar di browser tanpa SDK
                expireTime: options.expireSeconds,
                quality: options.quality ?? 2,
                ...(options.playback
                    ? {
                          type: 2 as const,
                          startTime: formatEzvizTime(options.playback.start),
                          stopTime: formatEzvizTime(options.playback.end),
                      }
                    : { type: 1 as const }),
            }),
        );

        // Jangan memakai live.expireTime: zona waktunya ternyata bukan WIB (terlihat di akun asli,
        // hasil parse jatuh 7 jam di masa lalu sehingga sesi langsung dianggap kedaluwarsa).
        // Umur alamat sudah kita tentukan sendiri lewat expireSeconds.
        const expiresAt = new Date(this.now().getTime() + options.expireSeconds * 1000);
        return { id: live.id, url: live.url, expiresAt };
    }

    async getPlayerAccess(ref: DeviceRef, options: { quality?: 1 | 2 } = {}): Promise<PlayerAccess> {
        const r = resolve(ref);
        const { accessToken, areaDomain } = await this.call(r.accountId, async (ctx) => ctx);
        const suffix = options.quality === 1 ? "hd.live" : "live";
        return {
            url: `ezopen://open.ezviz.com/${r.deviceSerial}/${r.channelNo}.${suffix}`,
            accessToken,
            domain: areaDomain,
        };
    }

    async stopLive(ref: DeviceRef, streamId: string): Promise<void> {
        const r = resolve(ref);
        await this.call(r.accountId, ({ accessToken, areaDomain }) =>
            this.client.disableLiveAddress(areaDomain, accessToken, r.deviceSerial, streamId, r.channelNo),
        );
    }

    async ptz(ref: DeviceRef, command: PtzCommand): Promise<void> {
        const r = resolve(ref);
        await this.call(r.accountId, ({ accessToken, areaDomain }) =>
            command.action === "start"
                ? this.client.ptzStart(areaDomain, accessToken, r.deviceSerial, r.channelNo, PTZ_DIRECTION[command.move], 1)
                : this.client.ptzStop(areaDomain, accessToken, r.deviceSerial, r.channelNo),
        );
    }

    async listRecordings(ref: DeviceRef, range: RecordingRange): Promise<RecordingRange[]> {
        const r = resolve(ref);
        const rows = await this.call(r.accountId, ({ accessToken, areaDomain }) =>
            this.client.queryLocalRecords(areaDomain, accessToken, r.deviceSerial, {
                channelNo: r.channelNo,
                startTime: formatEzvizTime(range.start),
                endTime: formatEzvizTime(range.end),
            }),
        );

        const segments: RecordingRange[] = [];
        for (const row of rows) {
            try {
                const start = parseEzvizTime(row.startTime);
                const end = parseEzvizTime(row.endTime);
                const clippedStart = start < range.start ? range.start : start;
                const clippedEnd = end > range.end ? range.end : end;
                if (clippedEnd > clippedStart) segments.push({ start: clippedStart, end: clippedEnd });
            } catch {
                // abaikan baris dengan format waktu tak dikenal
            }
        }
        return segments.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
}
