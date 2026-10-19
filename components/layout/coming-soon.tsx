import { Page } from "@/components/layout/page";

export function ComingSoon({ title }: { title: string }) {
    return (
        <Page className="gap-1">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-[13.5px] font-medium text-muted-foreground">Halaman ini segera hadir.</p>
        </Page>
    );
}
