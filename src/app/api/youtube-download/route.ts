import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10; 

/**
 * Lightweight Metadata and Resolution Fallback
 * Primary resolution is now handled CLIENT-SIDE to bypass Vercel 10s limits.
 */

const COBALT_INSTANCES = [
  "https://co.eepy.ovh/",
  "https://cobaltapi.cjs.nz/",
  "https://api.dl.woof.monster/",
];

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    // Server-side fallback (kept minimal to avoid timeout)
    const instance = COBALT_INSTANCES[Math.floor(Math.random() * COBALT_INSTANCES.length)];
    try {
      const res = await fetch(instance, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ url, downloadMode: "audio", audioFormat: "mp3" }),
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) return NextResponse.json({ url: data.url, status: "ok" });
      }
    } catch { /* proceed to 502 */ }

    return NextResponse.json({ error: "Resolution timeout on server. Client-side engine should have handled this." }, { status: 502 });
  } catch (error) {
    return NextResponse.json({ error: "Fault" }, { status: 500 });
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
    
    // Fast oEmbed for Title
    let title = "YouTube Video";
    try {
      const oRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(3000) });
      if (oRes.ok) {
        const data = await oRes.json();
        title = data.title || title;
      }
    } catch {}

    return NextResponse.json({ 
      videoId, 
      title,
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    });
  } catch (error) {
    return NextResponse.json({ error: "Metadata Fault" }, { status: 500 });
  }
}


