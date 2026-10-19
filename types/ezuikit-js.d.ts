// ezuikit-js tidak menyertakan deklarasi tipe; cukup bagian yang dipakai components/live/ezopen-player.tsx.
declare module "ezuikit-js" {
    export class EZUIKitPlayer {
        static EVENTS?: Record<string, unknown>;
        constructor(options: Record<string, unknown>);
        eventEmitter?: { on(event: string, fn: (payload: unknown) => void): void };
        play(): Promise<unknown>;
        stop(): Promise<unknown>;
        destroy(): Promise<unknown>;
        resize(width: number, height: number): void;
        openSound(): Promise<unknown> | void;
        closeSound(): Promise<unknown> | void;
        startTalk(): void;
        stopTalk(): void;
        enableZoom(): Promise<unknown> | void;
        closeZoom(): Promise<unknown> | void;
        startSave(fileName: string): Promise<unknown> | void;
        stopSave(): Promise<unknown> | void;
    }
}
