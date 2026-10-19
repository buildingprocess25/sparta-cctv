// Proxy generik untuk segmen HLS (.ts) dan sub-playlist (.m3u8) dari EZVIZ.
// Hanya domain EZVIZ yang diizinkan (allowlist) untuk mencegah SSRF.

const ALLOWED_HOSTS = [".ezvizlife.com", ".ys7.com", ".ezviz.com"];

function isAllowed(url: string): boolean {
    try {
        const { hostname } = new URL(url);
        return ALLOWED_HOSTS.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
    } catch {
        return false;
    }
}

function rewriteM3u8(text: string, selfBase: string): string {
    return text
        .split("\n")
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return line;
            // Baris URI: bisa relatif atau absolut
            const resolved = trimmed.startsWith("http") ? trimmed : null;
            if (!resolved) return line; // biarkan relatif apa adanya (jarang di EZVIZ)
            return `${selfBase}?url=${encodeURIComponent(resolved)}`;
        })
        .join("\n");
}

export async function GET(request: Request) {
    const { searchParams, origin, pathname } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl || !isAllowed(targetUrl)) {
        return Response.json({ error: "URL tidak diizinkan" }, { status: 400 });
    }

    try {
        const upstream = await fetch(targetUrl, {
            signal: AbortSignal.timeout(15_000),
            headers: { "User-Agent": "sparta-cctv/1.0" },
        });

        if (!upstream.ok) {
            return new Response(null, { status: upstream.status });
        }

        const contentType = upstream.headers.get("content-type") ?? "";

        // Untuk m3u8: rewrite semua URI baris supaya segmen juga lewat proxy
        if (
            contentType.includes("mpegurl") ||
            contentType.includes("x-mpegurl") ||
            targetUrl.includes(".m3u8")
        ) {
            const text = await upstream.text();
            const selfBase = `${origin}${pathname}`;
            const rewritten = rewriteM3u8(text, selfBase);
            return new Response(rewritten, {
                headers: {
                    "Content-Type": "application/vnd.apple.mpegurl",
                    "Cache-Control": "no-store",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }

        // Untuk segmen .ts: teruskan body langsung
        return new Response(upstream.body, {
            headers: {
                "Content-Type": upstream.headers.get("content-type") ?? "video/mp2t",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
            },
        });
    } catch (error) {
        console.error("[hls-proxy] fetch error:", error);
        return Response.json({ error: "Proxy gagal" }, { status: 502 });
    }
}
