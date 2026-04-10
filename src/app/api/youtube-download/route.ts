import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10; // Forced lower for Hobby safety

interface CobaltResponse {
  status: string;
  url?: string;
  text?: string;
  picker?: Array<{ url: string; type: string }>;
}

const COBALT_INSTANCES = [
  "https://api.cobalt.tools/",
  "https://co.eepy.ovh/",
  "https://cobalt.squair.xyz/",
  "https://dl.woof.monster/",
  "https://cobalt.clxxped.lol/",
];

/**
 * Parallel Resolution Pattern: Try the most reliable instances at once.
 * First one to return a valid URL wins.
 */
async function fetchFromCobalt(videoUrl: string, options: any = {}): Promise<CobaltResponse | null> {
  const bodyPayload = JSON.stringify({ url: videoUrl, ...options });
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s total timeout

  try {
    const promises = COBALT_INSTANCES.map(async (instance) => {
      try {
        const res = await fetch(instance, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: bodyPayload,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("instance failed");
        const data: CobaltResponse = await res.json();
        if (data.status === "error" || !data.url) throw new Error("no url");
        return data;
      } catch (e) {
        throw e;
      }
    });

    // Race for the first successful result
    const result = await Promise.any(promises);
    return result;
  } catch (err) {
    console.error("All Cobalt instances failed or timed out.");
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url, proxyStream } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL provided" }, { status: 400 });

    // Robust ID extraction
    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

    const requestOptions = proxyStream ? {} : { downloadMode: "audio", isAudioOnly: true, aFormat: "mp3" };
    const cobaltData = await fetchFromCobalt(url, requestOptions);
    
    if (!cobaltData?.url) {
      return NextResponse.json({ error: "Download service unavailable. Please retry or upload a file directly." }, { status: 502 });
    }

    if (!proxyStream) return NextResponse.json({ url: cobaltData.url, status: "ok" });

    // PROXY bytes server-side (only if proxyStream is true, e.g. for Studio)
    const videoRes = await fetch(cobaltData.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      signal: AbortSignal.timeout(50000), // Only works if Vercel supports it (Pro/Team)
    });
    
    if (!videoRes.ok) return NextResponse.json({ error: "Failed to fetch video stream" }, { status: 502 });

    const contentType = videoRes.headers.get("content-type") || "video/mp4";
    const contentLength = videoRes.headers.get("content-length");
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": 'attachment; filename="video.mp4"',
      "Cache-Control": "no-store",
    };
    if (contentLength) headers["Content-Length"] = contentLength;
    return new NextResponse(videoRes.body, { status: 200, headers });
  } catch (error) {
    console.error("YouTube download error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });
  try {
    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    
    // Return base thumbnail URLs; client side will handle high-res fallback via onError
    const thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    const fallbackThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    let title = "YouTube Video";
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(3000) });
      if (oembedRes.ok) { 
        const oembed = await oembedRes.json(); 
        title = oembed.title || title; 
      }
    } catch { /* fallback */ }

    return NextResponse.json({ videoId, title, thumbnail, fallbackThumbnail });
  } catch (error) {
    console.error("Metadata fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch metadata" }, { status: 500 });
  }
}

