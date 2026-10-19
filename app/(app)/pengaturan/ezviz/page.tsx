import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { AccountStatusBadge, tokenLifeText } from "@/components/admin/account-status";
import { AdminGate } from "@/components/admin/admin-gate";
import { Page } from "@/components/layout/page";
import { getAdminRuntime } from "@/lib/ezviz/admin-runtime";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function EzvizAccountsPage() {
    return (
        <AdminGate>
            <EzvizAccounts />
        </AdminGate>
    );
}

async function EzvizAccounts() {
    const contractors = await getAdminRuntime().store.listContractors();
    const now = new Date();

    return (
        <Page>
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold">Akun EZVIZ kontraktor</h1>
                <p className="text-[13.5px] font-medium text-muted-foreground">
                    Satu kontraktor = satu akun EZVIZ Open Platform (paket Free: maksimal 10 perangkat).
                </p>
            </div>

            <ul className="flex flex-col gap-3">
                {contractors.map((c) => {
                    const limit = c.account?.deviceLimit ?? 10;
                    return (
                        <li key={c.contractorId}>
                            <Link
                                href={`/pengaturan/ezviz/${c.contractorId}`}
                                className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card p-4 hover:bg-muted/50"
                            >
                                <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                                    <span className="text-sm font-semibold">{c.contractorName}</span>
                                    <AccountStatusBadge account={c.account} />
                                </div>
                                <dl className="flex flex-wrap gap-x-8 gap-y-1 text-[12.5px] font-medium">
                                    <div>
                                        <dt className="text-subtle">Perangkat</dt>
                                        <dd className={cn("font-semibold", c.mappedDevices >= limit && "text-status-warning")}>
                                            {c.mappedDevices}/{limit}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-subtle">Sisa umur token</dt>
                                        <dd className="font-semibold">{tokenLifeText(c.account, now)}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-subtle">Kamera di sistem</dt>
                                        <dd className="font-semibold">{c.cameraCount}</dd>
                                    </div>
                                </dl>
                                {c.account?.lastError && c.account.status !== "ACTIVE" && (
                                    <p className="w-full text-xs font-medium text-status-offline">{c.account.lastError}</p>
                                )}
                                <ChevronRight className="ml-auto size-4 text-subtle" />
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </Page>
    );
}
