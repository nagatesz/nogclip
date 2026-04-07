import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CobaltResponse {
  status: string;
  url?: string;
  text?: string;
  picker?: Array<{ url: string; type: string }>;
}

const COBALT_INSTANCES = [
  "https://co.eepy.ovh/",
  "https://cobalt.clxxped.lol/",
  "https://cobalt.meowing.de/",
  "https://cobalt.squair.xyz/",
  "https://cobalt.blackcat.sweeux.org/",
  "https://cobalt.kittycat.boo/",
  "https://dl.woof.monster/",
  "https://cobalt.cjs.nz/"
];

async function fetchFromCobalt(videoUrl: string, options: any = {}): Promise<CobaltResponse | null> {
  const bodyPayload = JSON.stringify({ url: videoUrl, ...options });
  
  for (const instance of COBALT_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(instance, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: bodyPayload,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) continue;
      const data: CobaltResponse = await res.json();
      if (data.status === "error") continue;
      if (data.url) return data;
    } catch (err) {
      continue;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { url, proxyStream } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL provided" }, { status: 400 });

    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(ytRegex);
    if (!match || !match[5]) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

    const requestOptions = proxyStream ? {} : { downloadMode: "audio" };
    // We send proxyStream = false to Cobalt to ensure no audio+video mux wait time if client just wants raw stream
    const cobaltData = await fetchFromCobalt(url, requestOptions);
    
    if (!cobaltData?.url) {
      return NextResponse.json({ error: "Download service unavailable. Please upload the video directly." }, { status: 502 });
    }

    if (!proxyStream) return NextResponse.json({ url: cobaltData.url, status: "ok" });

    // PROXY bytes server-side — fixes client CORS issue
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);
    const videoRes = await fetch(cobaltData.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
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
    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    const thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    const sdThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    let title = "YouTube Video";
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(5000) });
      if (oembedRes.ok) { const oembed = await oembedRes.json(); title = oembed.title || title; }
    } catch { /* fallback */ }
    return NextResponse.json({ videoId, title, thumbnail, sdThumbnail });
  } catch (error) {
    console.error("Metadata fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch metadata" }, { status: 500 });
  }
}
