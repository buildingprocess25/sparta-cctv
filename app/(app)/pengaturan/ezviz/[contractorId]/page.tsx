import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountForm } from "@/components/admin/account-form";
import { AccountStatusBadge, tokenLifeText } from "@/components/admin/account-status";
import { AddCameraForm } from "@/components/admin/add-camera-form";
import { AdminGate } from "@/components/admin/admin-gate";
import { SerialsForm } from "@/components/admin/serials-form";
import { SyncPanel } from "@/components/admin/sync-panel";
import { TestConnection } from "@/components/admin/test-connection";
import { ToggleAccount } from "@/components/admin/toggle-account";
import { Page } from "@/components/layout/page";
import { getAdminRuntime } from "@/lib/ezviz/admin-runtime";
import { formatDateTime } from "@/lib/format";
import {
    addCameraAction,
    saveAccountAction,
    saveSerialsAction,
    setAccountEnabledAction,
    syncDevicesAction,
    testConnectionAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function ContractorEzvizPage({ params }: { params: Promise<{ contractorId: string }> }) {
    const { contractorId } = await params;
    return (
        <AdminGate>
            <ContractorEzviz contractorId={contractorId} />
        </AdminGate>
    );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
            <header className="flex flex-col gap-0.5">
                <h2 className="text-[15px] font-semibold">{title}</h2>
                {description && <p className="text-[12.5px] font-medium text-muted-foreground">{description}</p>}
            </header>
            {children}
        </section>
    );
}

async function ContractorEzviz({ contractorId }: { contractorId: string }) {
    const { store } = getAdminRuntime();
    const contractor = await store.getContractor(contractorId);
    if (!contractor) notFound();

    const [cameras, stores] = await Promise.all([
        store.listContractorCameras(contractorId),
        store.listStoresByContractor(contractorId),
    ]);
    const account = contractor.account;
    const now = new Date();
    const limit = account?.deviceLimit ?? 10;

    return (
        <Page className="max-w-3xl">
            <nav className="flex items-center gap-1.5 text-[13px] font-medium" aria-label="Breadcrumb">
                <Link href="/pengaturan/ezviz" className="text-primary hover:underline">
                    Akun EZVIZ
                </Link>
                <ChevronRight className="size-[13px] text-subtle" />
                <span className="text-muted-foreground">{contractor.contractorName}</span>
            </nav>

            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">{contractor.contractorName}</h1>
                <AccountStatusBadge account={account} />
            </div>

            <Section
                title="Kredensial EZVIZ"
                description="appSecret disimpan terenkripsi dan tidak pernah ditampilkan kembali."
            >
                {account && (
                    <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-[12.5px] font-medium sm:grid-cols-2">
                        <div>
                            <dt className="text-subtle">Sisa umur token</dt>
                            <dd className="font-semibold">{tokenLifeText(account, now)}</dd>
                        </div>
                        <div>
                            <dt className="text-subtle">Token terakhir diperbarui</dt>
                            <dd className="font-semibold">{account.lastTokenRefreshAt ? formatDateTime(account.lastTokenRefreshAt) : "–"}</dd>
                        </div>
                        <div>
                            <dt className="text-subtle">Server wilayah</dt>
                            <dd className="font-mono font-semibold">{account.areaDomain ?? "–"}</dd>
                        </div>
                        <div>
                            <dt className="text-subtle">Batas perangkat (paket Free)</dt>
                            <dd className="font-semibold">{account.deviceLimit}</dd>
                        </div>
                        {account.lastError && account.status !== "ACTIVE" && (
                            <div className="sm:col-span-2">
                                <dt className="text-subtle">Error terakhir{account.lastErrorAt ? ` (${formatDateTime(account.lastErrorAt)})` : ""}</dt>
                                <dd className="font-semibold text-status-offline">{account.lastError}</dd>
                            </div>
                        )}
                    </dl>
                )}
                <AccountForm
                    action={saveAccountAction.bind(null, contractorId)}
                    defaultAppKey={account?.appKey ?? ""}
                    hasAccount={Boolean(account)}
                />
            </Section>

            {account && (
                <Section title="Koneksi dan status akun">
                    <TestConnection action={testConnectionAction.bind(null, contractorId)} disabled={account.status === "DISABLED"} />
                    <ToggleAccount enabled={account.status !== "DISABLED"} action={setAccountEnabledAction.bind(null, contractorId)} />
                </Section>
            )}

            <Section
                title="Perangkat kamera"
                description="Isi serial perangkat EZVIZ (9 karakter pada badan kamera) untuk tiap kamera. Maksimal 10 per akun."
            >
                <SerialsForm
                    action={saveSerialsAction.bind(null, contractorId)}
                    cameras={cameras}
                    mapped={contractor.mappedDevices}
                    limit={limit}
                />
                {account && <SyncPanel action={syncDevicesAction.bind(null, contractorId)} disabled={account.status === "DISABLED"} />}
            </Section>

            <Section
                title="Tambah kamera"
                description="Daftarkan slot kamera baru ke salah satu toko kontraktor ini. Setelah dibuat, isi serial perangkat di atas."
            >
                <AddCameraForm
                    action={addCameraAction.bind(null, contractorId)}
                    stores={stores}
                />
            </Section>
        </Page>
    );
}
