import type { AccountSummary } from "@/lib/ezviz/admin-store";
import { formatTimeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS = {
    ACTIVE: { label: "Aktif", className: "bg-status-online/10 text-status-online" },
    TOKEN_ERROR: { label: "Bermasalah", className: "bg-status-offline/10 text-status-offline" },
    DISABLED: { label: "Nonaktif", className: "bg-muted text-muted-foreground" },
} as const;

export function AccountStatusBadge({ account }: { account: AccountSummary | null }) {
    const meta = account ? STATUS[account.status] : { label: "Belum ada akun", className: "bg-muted text-subtle" };
    return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.className)}>{meta.label}</span>;
}

/** Sisa umur token untuk tampilan: "6 hari 4 jam", "habis", atau "belum ada token". */
export function tokenLifeText(account: AccountSummary | null, now: Date) {
    if (!account?.tokenExpiresAt) return "belum ada token";
    return formatTimeLeft(account.tokenExpiresAt, now);
}
