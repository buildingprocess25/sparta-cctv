import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/layout/coming-soon";

const SECTIONS: Record<string, string> = {
    kamera: "Semua Kamera",
    "perlu-ditindak": "Perlu Ditindak",
    toko: "Toko",
    kontraktor: "Kontraktor",
    pengaturan: "Pengaturan",
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
    const { section } = await params;
    const title = SECTIONS[section];
    if (!title) notFound();
    return <ComingSoon title={title} />;
}
