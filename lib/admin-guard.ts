// Sementara belum ada login, halaman admin akun EZVIZ (yang menyimpan secret kontraktor)
// harus dimatikan secara bawaan. Aktifkan hanya di lingkungan yang sudah dilindungi
// (reverse proxy dengan basic auth / IP kantor) lewat ADMIN_UI_ENABLED=true.
// Setelah autentikasi tersedia, ganti dengan pemeriksaan role.

export type AdminUiStatus = "ready" | "disabled" | "needs-db";

export function adminUiStatus(
    env: Record<string, string | undefined> = process.env,
): AdminUiStatus {
    if (env.ADMIN_UI_ENABLED !== "true") return "disabled";
    const source = env.CAMERA_DATA_SOURCE;
    if (source !== "db" && source !== "ezviz") return "needs-db";
    return "ready";
}
