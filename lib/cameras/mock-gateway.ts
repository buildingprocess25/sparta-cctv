import type { SdStatusValue } from "@/lib/ezviz/mappers";
import { startOfDayWib } from "@/lib/ezviz/time";
import { mockAccountId, mockSerial, seedStores, type SeedCamera } from "@/lib/seed-data";
import { GatewayError } from "./errors";
import type {
    CameraGateway,
    DeviceCheck,
    DeviceRef,
    LiveStream,
    PlayerAccess,
    RecordingRange,
    SnapshotImage,
    StartLiveOptions,
} from "./gateway";

type MockDevice = { accountId: string; serial: string; camera: SeedCamera };

// Segmen rekaman contoh dalam menit sejak 00:00 WIB (mengikuti desain Figma).
const BASE_SEGMENTS: [number, number][] = [
    [0, 138],
    [174, 468],
    [487, 697],
    [720, 24 * 60],
];

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#262c35"/><text x="320" y="185" fill="#ffffff66" font-family="sans-serif" font-size="16" text-anchor="middle">Snapshot kamera (mock)</text></svg>`;

/** Gateway berbasis data contoh (lib/seed-data.ts) — untuk pengembangan tanpa EZVIZ. */
export class MockGateway implements CameraGateway {
    readonly kind = "mock" as const;

    private readonly devices: MockDevice[];
    private readonly now: () => Date;

    constructor(now: () => Date = () => new Date()) {
        this.now = now;
        this.devices = seedStores.flatMap((store, si) =>
            store.cameras.map((camera, ci) => ({
                accountId: mockAccountId(store.contractor),
                serial: mockSerial(si, ci),
                camera,
            })),
        );
    }

    private find(ref: DeviceRef): MockDevice {
        const device = this.devices.find((d) => d.serial === ref.deviceSerial);
        if (!device) throw new GatewayError("not_found", "Perangkat contoh tidak ditemukan");
        return device;
    }

    async checkAccountDevices(accountId: string): Promise<DeviceCheck[]> {
        return this.devices
            .filter((d) => d.accountId === accountId)
            .map((d) => ({
                deviceSerial: d.serial,
                connection: d.camera.status === "OFFLINE" ? "OFFLINE" : d.camera.status === "UNKNOWN" ? "UNKNOWN" : "ONLINE",
                deviceType: "H8c",
                encrypted: false,
            }));
    }

    async getSdStatus(ref: DeviceRef): Promise<SdStatusValue | null> {
        return this.find(ref).camera.sdStatus ?? "OK";
    }

    async captureSnapshot(ref: DeviceRef): Promise<SnapshotImage> {
        const { camera } = this.find(ref);
        if (camera.status === "OFFLINE") throw new GatewayError("offline", "Kamera offline");
        return { bytes: new TextEncoder().encode(PLACEHOLDER_SVG), contentType: "image/svg+xml" };
    }

    async startLive(ref: DeviceRef, options: StartLiveOptions): Promise<LiveStream> {
        const { camera, serial } = this.find(ref);
        if (camera.status === "OFFLINE") throw new GatewayError("offline", "Kamera offline");
        return {
            id: `mock-${serial}-${this.now().getTime()}`,
            url: `https://mock.invalid/${options.playback ? "playback" : "live"}/${serial}.m3u8`,
            expiresAt: new Date(this.now().getTime() + options.expireSeconds * 1000),
        };
    }

    async stopLive(): Promise<void> {
        // tidak ada yang perlu dihentikan
    }

    async getPlayerAccess(): Promise<PlayerAccess> {
        throw new GatewayError("unsupported", "Live tidak tersedia pada data contoh");
    }

    async ptz(ref: DeviceRef): Promise<void> {
        if (this.find(ref).camera.status === "OFFLINE") throw new GatewayError("offline", "Kamera offline");
    }

    async listRecordings(ref: DeviceRef, range: RecordingRange): Promise<RecordingRange[]> {
        const { camera } = this.find(ref);
        if (camera.sdStatus === "NONE" || camera.sdStatus === "UNREADABLE") return [];

        const now = this.now();
        const dayStart = startOfDayWib(range.start).getTime();
        // Kamera offline berhenti merekam sejak status offline dimulai.
        const limit =
            camera.status === "OFFLINE" && camera.sinceMinutes
                ? now.getTime() - camera.sinceMinutes * 60_000
                : now.getTime();

        const segments: RecordingRange[] = [];
        for (const [startMin, endMin] of BASE_SEGMENTS) {
            const start = Math.max(dayStart + startMin * 60_000, range.start.getTime());
            const end = Math.min(dayStart + endMin * 60_000, limit, range.end.getTime());
            if (end > start) segments.push({ start: new Date(start), end: new Date(end) });
        }
        return segments;
    }
}
