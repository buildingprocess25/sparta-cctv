export type GatewayErrorKind =
    /** perangkat offline (bukan kegagalan sistem) */
    | "offline"
    /** perangkat tidak ada / bukan milik akun / serial belum diisi */
    | "not_found"
    | "unsupported"
    /** kuota atau frekuensi panggilan EZVIZ terlampaui */
    | "rate_limited"
    /** akun EZVIZ tidak dapat dipakai (nonaktif, kredensial salah, token gagal) */
    | "account_unavailable"
    /** gangguan sementara: boleh dicoba lagi */
    | "transient";

export class GatewayError extends Error {
    constructor(
        readonly kind: GatewayErrorKind,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = "GatewayError";
    }
}

/**
 * instanceof saja tidak cukup: di dev (Turbopack) modul yang sama bisa dimuat dua kali
 * (bundle route vs. server component), sehingga kelas GatewayError-nya berbeda identitas.
 */
export function isGatewayError(error: unknown): error is GatewayError {
    return error instanceof GatewayError || (error instanceof Error && error.name === "GatewayError" && "kind" in error);
}
