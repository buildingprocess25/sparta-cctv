import { CameraTile } from "@/components/dashboard/camera-tile";
import { formatShortDate } from "@/lib/format";
import type { StoreView } from "@/lib/monitoring";

function ProgressBar({ value }: { value: number }) {
    return (
        <div
            role="progressbar"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"
        >
            <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
        </div>
    );
}

export function StoreCard({ store, now }: { store: StoreView; now: Date }) {
    return (
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 lg:px-5 lg:pt-[18px] lg:pb-5">
            {/* Header mobile */}
            <header className="flex flex-col gap-1 lg:hidden">
                <h2 className="text-[15px] font-semibold">{store.name}</h2>
                <p className="text-xs font-medium text-muted-foreground">
                    {store.code} · {store.contractorName}
                </p>
                <div className="flex items-center gap-2.5">
                    <ProgressBar value={store.progress} />
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {store.progress}%
                        {store.targetDate ? ` · target ${formatShortDate(store.targetDate).replace(/ \d{4}$/, "")}` : ""}
                    </span>
                </div>
            </header>

            {/* Header desktop */}
            <header className="hidden flex-wrap items-center justify-between gap-x-6 gap-y-3 lg:flex">
                <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-baseline gap-2.5">
                        <h2 className="text-base font-semibold">{store.name}</h2>
                        <span className="font-mono text-xs font-medium text-subtle">{store.code}</span>
                    </div>
                    <p className="text-[12.5px] font-medium text-muted-foreground">
                        {store.contractorName} · {store.address}
                    </p>
                </div>
                <div className="flex w-[200px] flex-col gap-1.5">
                    <p className="flex items-baseline gap-1.5 whitespace-nowrap">
                        <span className="text-[13px] font-semibold">Progres {store.progress}%</span>
                        {store.targetDate ? (
                            <span className="text-[12.5px] font-medium text-subtle">
                                · target {formatShortDate(store.targetDate)}
                            </span>
                        ) : null}
                    </p>
                    <div className="flex">
                        <ProgressBar value={store.progress} />
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {store.cameras.map((camera) => (
                    <CameraTile key={camera.id} camera={camera} now={now} />
                ))}
            </div>
        </section>
    );
}
