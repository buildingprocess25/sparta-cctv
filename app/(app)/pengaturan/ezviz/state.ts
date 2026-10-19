import type { DeviceDiff } from "@/lib/ezviz/admin-service";

// Tipe state untuk server action. Dipisah dari actions.ts karena berkas "use server"
// hanya boleh mengekspor fungsi async.

export type FormState = { ok: boolean; message: string; errors?: Record<string, string> } | null;

export type TestState =
    | null
    | { ok: false; message: string }
    | { ok: true; message: string; deviceCount: number; overLimit: boolean; tokenExpiresAt: string; areaDomain: string };

export type SyncState =
    | null
    | { ok: false; message: string }
    | { ok: true; deviceCount: number; overLimit: boolean; diff: DeviceDiff };
