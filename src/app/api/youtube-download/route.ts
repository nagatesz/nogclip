import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for long video downloads

/**
 * YouTube download API using ytdl-core for direct server-side download
 * Streams video directly from YouTube to client without relying on expiring URLs
 */

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const proxy = searchParams.get("proxy");
  const { url, format = "video" } = await request.json();
  
  if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

  const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
  const videoId = idMatch?.[1];
  if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

  // If proxy=true, stream the video directly using ytdl-core
  if (proxy === "true") {
    try {
      console.log("Starting direct video download for:", url);
      
      const isValid = ytdl.validateURL(url);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
      }

      // Get video info first
      const info = await ytdl.getInfo(url);
      
      // Choose format
      let formatFilter: ytdl.Filter = "audioandvideo";
      if (format === "audio") {
        formatFilter = "audioonly";
      }

      const formats = ytdl.filterFormats(info.formats, formatFilter);
      if (formats.length === 0) {
        return NextResponse.json({ error: "No available formats" }, { status: 400 });
      }

      // Select best format
      let selectedFormat = formats[0];
      if (format === "audio") {
        selectedFormat = formats.find(f => f.container === "mp4") || formats[0];
      } else {
        selectedFormat = formats.find(f => f.hasVideo && f.hasAudio && f.container === "mp4") || formats[0];
      }

      console.log("Selected format:", selectedFormat.quality, selectedFormat.container);

      // Create readable stream from ytdl
      const videoStream = ytdl(url, {
        format: selectedFormat,
        quality: "highest",
      });

      // Convert stream to Web API ReadableStream
      const { Readable } = require('stream');
      const { Writable } = require('stream');
      
      // Create a Transform to convert Node stream to Web stream
      const webStream = new ReadableStream({
        async start(controller) {
          videoStream.on('data', (chunk) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          videoStream.on('end', () => {
            controller.close();
          });
          videoStream.on('error', (err) => {
            console.error("Stream error:", err);
            controller.error(err);
          });
        }
      });

      const headers: Record<string, string> = {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${info.videoDetails.title?.replace(/[^a-zA-Z0-9]/g, '_') || 'video'}.mp4"`,
        "Cache-Control": "no-cache",
      };

      return new NextResponse(webStream, { headers });
    } catch (error: any) {
      console.error("Direct download error:", error);
      return NextResponse.json({ error: error.message || "Download failed" }, { status: 500 });
    }
  }

  // Normal flow: return metadata and tell client to use proxy
  try {
    const isValid = ytdl.validateURL(url);
    if (!isValid) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

    const info = await ytdl.getInfo(url);
    
    return NextResponse.json({ 
      url: url, // Return original URL for proxy
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url,
      duration: parseInt(info.videoDetails.lengthSeconds),
      status: "ok",
      useProxy: true // Always use proxy for reliable download
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
    const info = await ytdl.getInfo(url);
    
    return NextResponse.json({ 
      videoId, 
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: parseInt(info.videoDetails.lengthSeconds),
      author: info.videoDetails.author.name
    });
  } catch (error: any) {
    console.error("Metadata error:", error);
    // Fallback to oEmbed
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


