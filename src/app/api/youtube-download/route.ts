import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * YouTube download API
 * NOTE: YouTube blocks server-side downloads with bot detection
 * Users should download videos manually and upload them instead
 */

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    // Try to get basic metadata via oEmbed
    try {
      const oRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(5000) });
      if (oRes.ok) {
        const data = await oRes.json();
        return NextResponse.json({ 
          url: url,
          title: data.title || "YouTube Video",
          thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          status: "ok",
          useProxy: false // Direct download is blocked, user must upload manually
        });
      }
    } catch {}

    // Fallback with basic info
    return NextResponse.json({ 
      url: url,
      title: "YouTube Video",
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      status: "ok",
      useProxy: false
    });
  } catch (error: any) {
    console.error("YouTube info error:", error);
    return NextResponse.json({ error: error.message || "Could not fetch video info" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });
  
  const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
  const videoId = idMatch?.[1];
  if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  
  try {
    const oRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(5000) });
    if (oRes.ok) {
      const data = await oRes.json();
      return NextResponse.json({ 
        videoId, 
        title: data.title || "YouTube Video",
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      });
    }
  } catch {}
  
  return NextResponse.json({ 
    videoId, 
    title: "YouTube Video",
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  });
}


