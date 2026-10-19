// Sajikan m3u8 yang sudah di-proxy untuk kamera tertentu.
// URL asli EZVIZ tidak pernah sampai ke browser.


export const dynamic = "force-dynamic";

function rewriteM3u8(text: string, proxyBase: string): string {
    return text
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return line;
            if (trimmed.startsWith("http")) {
                return `${proxyBase}?url=${encodeURIComponent(trimmed)}`;
            }
            return line;
        })
        .join("\n");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { default: prisma } = await import("@/lib/prisma");
    const session = await prisma.liveSession.findFirst({
        where: { cameraId: decodeURIComponent(id), endedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { startedAt: "desc" },
        select: { hlsUrl: true },
    });
    const url = session?.hlsUrl ?? null;

    if (!url) {
        return Response.json({ error: "Tidak ada sesi live aktif. Mulai stream ulang." }, { status: 404 });
    }

    try {
        const upstream = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
            headers: { "User-Agent": "sparta-cctv/1.0" },
        });

        if (!upstream.ok) {
            console.error("[hls] upstream error:", upstream.status);
            return new Response(null, { status: upstream.status });
        }

        const text = await upstream.text();
        // EZVIZ membalas 200 tetapi isinya segmen placeholder "/ErrCode/<kode>_0.ts" bila stream gagal.
        const errCode = /\/ErrCode\/(\d+)_\d+\.ts/.exec(text)?.[1];
        if (errCode) {
            console.error(`[hls] EZVIZ mengembalikan ErrCode ${errCode} untuk kamera ${id}`);
            return Response.json(
                { error: `Kamera tidak mengirim video (kode EZVIZ ${errCode})`, errCode },
                { status: 502 },
            );
        }

        const { origin } = new URL(request.url);
        const proxyBase = `${origin}/api/hls-proxy`;
        const rewritten = rewriteM3u8(text, proxyBase);

        return new Response(rewritten, {
            headers: {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
            },
        });
    } catch (error) {
        console.error("[hls] fetch m3u8 error:", error);
        return Response.json({ error: "Gagal mengambil stream" }, { status: 502 });
    }
}
