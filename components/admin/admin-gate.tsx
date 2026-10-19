import { ShieldAlert } from "lucide-react";
import { Page } from "@/components/layout/page";
import { adminUiStatus } from "@/lib/admin-guard";

const code = "rounded bg-muted px-1 font-mono text-xs";

/** Menampilkan konten admin hanya bila ADMIN_UI_ENABLED=true dan mode database aktif. */
export function AdminGate({ children }: { children: React.ReactNode }) {
    const status = adminUiStatus();
    if (status === "ready") return <>{children}</>;

    return (
        <Page>
            <div className="flex max-w-xl flex-col gap-3 rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2 text-status-warning">
                    <ShieldAlert className="size-5" />
                    <h1 className="text-base font-semibold">
                        {status === "disabled" ? "Halaman admin dinonaktifkan" : "Butuh mode database"}
                    </h1>
                </div>
                {status === "disabled" ? (
                    <p className="text-[13px] font-medium text-muted-foreground">
                        Halaman ini menyimpan kredensial EZVIZ kontraktor dan belum memiliki login. Aktifkan hanya di lingkungan yang
                        sudah dilindungi (basic auth atau IP kantor di reverse proxy) dengan{" "}
                        <code className={code}>ADMIN_UI_ENABLED=true</code> di <code className={code}>.env</code>.
                    </p>
                ) : (
                    <p className="text-[13px] font-medium text-muted-foreground">
                        Atur <code className={code}>CAMERA_DATA_SOURCE=db</code> atau <code className={code}>ezviz</code> dan siapkan
                        database (migrasi + seed) terlebih dahulu.
                    </p>
                )}
            </div>
        </Page>
    );
}
