// ezuikit-js tidak menyertakan deklarasi tipe; cukup bagian yang dipakai components/live/ezopen-player.tsx.
declare module "ezuikit-js" {
    export class EZUIKitPlayer {
        constructor(options: Record<string, unknown>);
        play(): Promise<unknown>;
        stop(): Promise<unknown>;
        destroy(): Promise<unknown>;
    }
}
