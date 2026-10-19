"use server";

import { revalidatePath } from "next/cache";
import { adminUiStatus } from "@/lib/admin-guard";
import { getAdminRuntime } from "@/lib/ezviz/admin-runtime";
import type { FormState, SyncState, TestState } from "./state";

const DISABLED_MESSAGE = "Halaman admin EZVIZ tidak aktif (ADMIN_UI_ENABLED / mode database).";

function refresh(contractorId: string) {
    revalidatePath("/pengaturan/ezviz");
    revalidatePath(`/pengaturan/ezviz/${contractorId}`);
}

/** Setiap action memeriksa guard sendiri: action dapat dipanggil langsung, tidak hanya lewat halaman. */
function blocked(): { ok: false; message: string } | null {
    return adminUiStatus() === "ready" ? null : { ok: false, message: DISABLED_MESSAGE };
}

function unexpected(error: unknown): { ok: false; message: string } {
    console.error("[ezviz-admin]", error instanceof Error ? error.message : "error tidak dikenal");
    return { ok: false, message: "Terjadi kesalahan di server. Coba lagi." };
}

export async function saveAccountAction(contractorId: string, _prev: FormState, formData: FormData): Promise<FormState> {
    const stop = blocked();
    if (stop) return stop;
    try {
        const result = await getAdminRuntime().service.saveAccount(contractorId, {
            appKey: String(formData.get("appKey") ?? ""),
            appSecret: String(formData.get("appSecret") ?? ""),
        });
        if (!result.ok) return { ok: false, message: result.error };
        refresh(contractorId);
        if (result.created) return { ok: true, message: "Akun EZVIZ dibuat. Jalankan uji koneksi untuk memastikan kredensial benar." };
        return { ok: true, message: result.changed ? "Kredensial diperbarui. Jalankan uji koneksi." : "Tidak ada perubahan." };
    } catch (error) {
        return unexpected(error);
    }
}

export async function testConnectionAction(contractorId: string): Promise<TestState> {
    const stop = blocked();
    if (stop) return stop;
    try {
        const result = await getAdminRuntime().service.testConnection(contractorId);
        refresh(contractorId);
        if (!result.ok) return { ok: false, message: result.error };
        return {
            ok: true,
            message: "Terhubung ke EZVIZ.",
            deviceCount: result.deviceCount,
            overLimit: result.overLimit,
            tokenExpiresAt: result.tokenExpiresAt.toISOString(),
            areaDomain: result.areaDomain,
        };
    } catch (error) {
        return unexpected(error);
    }
}

export async function syncDevicesAction(contractorId: string): Promise<SyncState> {
    const stop = blocked();
    if (stop) return stop;
    try {
        const result = await getAdminRuntime().service.syncDevices(contractorId);
        if (!result.ok) return { ok: false, message: result.error };
        return { ok: true, deviceCount: result.deviceCount, overLimit: result.overLimit, diff: result.diff };
    } catch (error) {
        return unexpected(error);
    }
}

export async function setAccountEnabledAction(contractorId: string, enabled: boolean): Promise<FormState> {
    const stop = blocked();
    if (stop) return stop;
    try {
        const result = await getAdminRuntime().service.setAccountEnabled(contractorId, enabled);
        if (!result.ok) return { ok: false, message: result.error };
        refresh(contractorId);
        return { ok: true, message: enabled ? "Akun diaktifkan." : "Akun dinonaktifkan. Kamera kontraktor ini tampil sebagai status belum diketahui." };
    } catch (error) {
        return unexpected(error);
    }
}

export async function saveSerialsAction(contractorId: string, _prev: FormState, formData: FormData): Promise<FormState> {
    const stop = blocked();
    if (stop) return stop;
    try {
        const { service, store } = getAdminRuntime();
        // Hanya kamera milik kontraktor ini yang boleh diubah, apa pun isi form.
        const allowed = new Map((await store.listContractorCameras(contractorId)).map((c) => [c.id, c]));
        const entries = [...allowed.values()].map((c) => ({ cameraId: c.id, serial: String(formData.get(`serial:${c.id}`) ?? c.deviceSerial ?? "") }));

        const results = await service.mapCameraSerials(entries);
        const errors: Record<string, string> = {};
        let changed = 0;
        for (const { cameraId, result } of results) {
            if (!result.ok) errors[cameraId] = result.error;
            else if (result.changed) changed++;
        }
        refresh(contractorId);
        const failed = Object.keys(errors).length;
        if (failed > 0) {
            return { ok: false, message: `${failed} kamera gagal disimpan${changed ? `, ${changed} berhasil` : ""}.`, errors };
        }
        return { ok: true, message: changed ? `${changed} perubahan disimpan.` : "Tidak ada perubahan." };
    } catch (error) {
        return unexpected(error);
    }
}
