import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for long video downloads

/**
 * Server-side YouTube download using ytdl-core
 * More reliable than Cobalt API for long videos
 */

export async function POST(request: NextRequest) {
  try {
    const { url, format = "video" } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    // Validate URL with ytdl
    const isValid = ytdl.validateURL(url);
    if (!isValid) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

    // Get video info first
    let info;
    try {
      info = await ytdl.getInfo(url);
    } catch (e: any) {
      console.error("ytdl getInfo error:", e);
      return NextResponse.json({ error: "Could not fetch video info. The video may be age-restricted or unavailable." }, { status: 400 });
    }

    // Choose format based on request
    let formatFilter: ytdl.Filter = "audioandvideo";

    if (format === "audio") {
      formatFilter = "audioonly";
    }

    // Find the best format
    const formats = ytdl.filterFormats(info.formats, formatFilter);
    if (formats.length === 0) {
      return NextResponse.json({ error: "No available formats for this video" }, { status: 400 });
    }

    // Select format (prefer mp4 with video+audio, or highest quality audio)
    let selectedFormat = formats[0];
    if (format === "audio") {
      selectedFormat = formats.find(f => f.container === "mp4") || formats[0];
    } else {
      // For video, prefer mp4 with both audio and video
      selectedFormat = formats.find(f => f.hasVideo && f.hasAudio && f.container === "mp4") || formats[0];
    }

    // Return the direct download URL from ytdl
    return NextResponse.json({ 
      url: selectedFormat.url,
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url,
      duration: parseInt(info.videoDetails.lengthSeconds),
      status: "ok"
    });
  } catch (error: any) {
    console.error("YouTube download error:", error);
    return NextResponse.json({ error: error.message || "Download failed" }, { status: 500 });
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
    // Use ytdl for metadata
    const info = await ytdl.getInfo(url);
    
    // Get the best thumbnail
    const thumbnails = info.videoDetails.thumbnails;
    const bestThumbnail = thumbnails[thumbnails.length - 1]?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    return NextResponse.json({ 
      videoId, 
      title: info.videoDetails.title,
      thumbnail: bestThumbnail,
      fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: parseInt(info.videoDetails.lengthSeconds),
      author: info.videoDetails.author.name
    });
  } catch (error: any) {
    console.error("Metadata error:", error);
    // Fallback to oEmbed if ytdl fails
    try {
      const oRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(3000) });
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
    return NextResponse.json({ error: "Metadata Fault" }, { status: 500 });
  }
}


