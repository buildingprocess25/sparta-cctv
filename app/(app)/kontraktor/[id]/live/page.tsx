import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MultiLiveGrid } from "@/components/multi-live/multi-live-grid";
import { getDataSource } from "@/lib/cameras";
import { getContractorLive, type ContractorLiveView } from "@/lib/monitoring";

const ACCOUNT_BLOCKED: Record<"TOKEN_ERROR" | "DISABLED", string> = {
    TOKEN_ERROR: "Akun EZVIZ kontraktor bermasalah, live tidak tersedia",
    DISABLED: "Akun EZVIZ kontraktor dinonaktifkan, live tidak tersedia",
};

function blockedMessage(account: ContractorLiveView["account"]): string | null {
    if (getDataSource() === "mock") return "Live tidak tersedia pada mode mock";
    if (!account) return "Kontraktor belum punya akun EZVIZ";
    return account.status === "ACTIVE" ? null : ACCOUNT_BLOCKED[account.status];
}

export default async function ContractorLivePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const data = await getContractorLive(decodeURIComponent(id));
    if (!data) notFound();

    const { contractor, cameras, maxLive } = data;
    const storeCount = new Set(cameras.map((c) => c.storeCode)).size;
    const subtitle = `${cameras.length} kamera · ${storeCount} toko · maks. ${maxLive} live bersamaan`;

    return (
        <div className="flex flex-col gap-4 pb-safe-nav lg:gap-5 lg:px-7 lg:pt-5 lg:pb-8">
            {/* Header mobile */}
            <header className="flex items-center gap-1.5 bg-white py-2 pr-4 pl-2 lg:hidden">
                <Link href="/" aria-label="Kembali" className="flex size-10 items-center justify-center">
                    <ChevronLeft className="size-[22px]" />
                </Link>
                <div className="min-w-0">
                    <p className="truncate text-base font-semibold">Live semua kamera</p>
                    <p className="truncate text-xs font-medium text-muted-foreground">{contractor.name}</p>
                </div>
            </header>

            {/* Header desktop */}
            <header className="hidden flex-col gap-1.5 lg:flex">
                <nav className="flex items-center gap-1.5 text-[13px] font-medium" aria-label="Breadcrumb">
                    <Link href="/" className="text-primary hover:underline">
                        Dashboard
                    </Link>
                    <ChevronRight className="size-[13px] text-subtle" />
                    <span className="text-muted-foreground">{contractor.name}</span>
                </nav>
                <h1 className="text-2xl font-bold">Live semua kamera</h1>
                <p className="text-[13px] font-medium text-muted-foreground">{subtitle}</p>
            </header>

            <div className="px-4 lg:px-0">
                <MultiLiveGrid cameras={cameras} maxLive={maxLive} blockedMessage={blockedMessage(data.account)} />
            </div>
        </div>
    );
}
