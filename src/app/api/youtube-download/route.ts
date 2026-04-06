import { NextRequest, NextResponse } from "next/server";
import { Innertube } from "youtubei.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { url, proxyStream } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL provided" }, { status: 400 });

    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(ytRegex);
    if (!match || !match[5]) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    const videoId = match[5];

    let downloadUrl: string | undefined;

    try {
      const yt = await Innertube.create();
      const info = await yt.getBasicInfo(videoId);
      const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
      downloadUrl = format?.url;
    } catch (err) {
      console.error("youtubei.js error:", err);
    }

    if (!downloadUrl) {
      return NextResponse.json({ error: "Download service unavailable. Please upload the video directly." }, { status: 502 });
    }

    if (!proxyStream) return NextResponse.json({ url: downloadUrl, status: "ok" });

    // PROXY bytes server-side — fixes client CORS issue
    const videoRes = await fetch(downloadUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      signal: AbortSignal.timeout(55000),
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
