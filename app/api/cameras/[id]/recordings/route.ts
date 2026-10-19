import { parseWibDateKey, startOfDayWib } from "@/lib/ezviz/time";
import { getCameraRecordings } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

// GET /api/cameras/[id]/recordings?date=yyyy-MM-dd (WIB) — segmen rekaman MicroSD satu hari,
// dalam menit sejak 00:00 WIB. Balasan: { recordings, recordingsError }.
// CATATAN: belum ada autentikasi — wajib dilindungi sebelum production (docs/ezviz-integration-plan.md §9).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const dateParam = new URL(req.url).searchParams.get("date");
    const dayStart = dateParam ? parseWibDateKey(dateParam) : startOfDayWib(new Date());
    if (!dayStart) return Response.json({ error: "Tanggal tidak valid" }, { status: 400 });
    if (dayStart.getTime() > Date.now()) return Response.json({ error: "Tanggal belum terjadi" }, { status: 400 });

    const result = await getCameraRecordings(decodeURIComponent(id), dayStart);
    if (!result) return Response.json({ error: "Kamera tidak ditemukan" }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
