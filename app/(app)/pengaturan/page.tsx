import { ChevronRight, KeyRound } from "lucide-react";
import Link from "next/link";
import { Page } from "@/components/layout/page";

export default function SettingsPage() {
    return (
        <Page>
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold">Pengaturan</h1>
                <p className="text-[13.5px] font-medium text-muted-foreground">Konfigurasi sistem monitoring CCTV.</p>
            </div>
            <Link
                href="/pengaturan/ezviz"
                className="flex max-w-xl items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50"
            >
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <KeyRound className="size-5" />
                </span>
                <span className="flex flex-1 flex-col">
                    <span className="text-sm font-semibold">Akun EZVIZ kontraktor</span>
                    <span className="text-[12.5px] font-medium text-muted-foreground">
                        Kredensial, uji koneksi, dan pemetaan serial kamera
                    </span>
                </span>
                <ChevronRight className="size-4 text-subtle" />
            </Link>
        </Page>
    );
}
