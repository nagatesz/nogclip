import { NextRequest, NextResponse } from "next/server";
import { Innertube, UniversalCache } from "youtubei.js";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for long video downloads

/**
 * Multi-fallback YouTube download API
 * Tries multiple methods in order: youtubei.js -> Cobalt API -> Suggest file upload
 * Also provides proxy endpoint for actual video downloads
 */

const COBALT_INSTANCES = [
  "https://api.cobalt.tools/",
  "https://cobalt-api.kwiatekmiki.com/",
  "https://co.eepy.ovh/",
  "https://cobaltapi.cjs.nz/",
  "https://api.dl.woof.monster/",
];

let innertubeInstance: Innertube | null = null;

async function getInnertube() {
  if (!innertubeInstance) {
    innertubeInstance = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
    });
  }
  return innertubeInstance;
}

async function tryYoutubeiJS(url: string, format: string) {
  try {
    const youtube = await getInnertube();
    const info = await youtube.getInfo(url);
    
    const streamingData = info.streaming_data;
    if (!streamingData) {
      throw new Error("No streaming data");
    }

    const formats = format === "audio" 
      ? streamingData.adaptive_formats.filter((f: any) => f.mime_type?.includes('audio'))
      : streamingData.formats;

    if (formats.length === 0) {
      throw new Error("No formats available");
    }

    let selectedFormat = formats[0];
    if (format === "audio") {
      selectedFormat = formats.find((f: any) => f.mime_type?.includes('mp4')) || formats[0];
    } else {
      selectedFormat = formats.find((f: any) => f.has_video && f.has_audio && f.mime_type?.includes('mp4')) || formats[0];
    }

    const basicInfo = info.basic_info;
    
    return {
      url: selectedFormat.url,
      title: basicInfo.title,
      thumbnail: basicInfo.thumbnail?.[0]?.url,
      duration: basicInfo.duration,
    };
  } catch (e: any) {
    console.error("youtubei.js failed:", e.message);
    return null;
  }
}

async function tryCobaltAPI(url: string, format: string) {
  for (const instance of COBALT_INSTANCES) {
    try {
      const res = await fetch(instance, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ 
          url, 
          downloadMode: format === "audio" ? "audio" : "auto",
          videoQuality: "1080",
          filenameStyle: "basic"
        }),
        signal: AbortSignal.timeout(15000),
      });
      
      if (!res.ok) continue;
      
      const data = await res.json();
      if (data.status === "error") continue;
      if (data.url) {
        return {
          url: data.url,
          title: data.filename || "YouTube Video",
          thumbnail: data.thumbnail,
          duration: undefined,
        };
      }
    } catch (e) {
      console.error(`Cobalt instance ${instance} failed:`, e);
      continue;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const proxy = searchParams.get("proxy");
  
  // If proxy=true, handle actual video download through server
  if (proxy === "true") {
    try {
      const { videoUrl } = await request.json();
      if (!videoUrl) return NextResponse.json({ error: "No video URL" }, { status: 400 });

      console.log("Proxying video download for:", videoUrl);
      
      const videoRes = await fetch(videoUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(290000), // 4:50 timeout (under 5 min max)
      });
      
      if (!videoRes.ok) {
        console.error("Proxy fetch failed:", videoRes.status, videoRes.statusText);
        return NextResponse.json({ error: `Failed to fetch video: ${videoRes.status}` }, { status: videoRes.status });
      }
      
      if (!videoRes.body) {
        return NextResponse.json({ error: "No response body" }, { status: 500 });
      }

      // Stream the video to the client
      const contentType = videoRes.headers.get("content-type") || "video/mp4";
      const contentLength = videoRes.headers.get("content-length");
      
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      };
      if (contentLength) headers["Content-Length"] = contentLength;
      
      return new NextResponse(videoRes.body, { status: 200, headers });
    } catch (error: any) {
      console.error("Proxy error:", error);
      return NextResponse.json({ error: error.message || "Proxy failed" }, { status: 500 });
    }
  }

  // Normal flow: get download URL
  try {
    const { url, format = "video" } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    // Try youtubei.js first
    let result = await tryYoutubeiJS(url, format);
    if (result) {
      return NextResponse.json({ 
        ...result,
        thumbnail: result.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        status: "ok",
        useProxy: true // Tell client to use proxy endpoint
      });
    }

    // Fallback to Cobalt API
    result = await tryCobaltAPI(url, format);
    if (result) {
      return NextResponse.json({ 
        ...result,
        thumbnail: result.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        status: "ok",
        useProxy: true
      });
    }

    // All methods failed
    return NextResponse.json({ 
      error: "All download methods failed. The video may be age-restricted, or YouTube is blocking requests from this server. Please download the video manually and upload it using the '📂 Upload File' button." 
    }, { status: 400 });

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
    // Try youtubei.js for metadata
    const youtube = await getInnertube();
    const info = await youtube.getInfo(url);
    const basicInfo = info.basic_info;
    
    const thumbnail = basicInfo.thumbnail?.[0]?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    return NextResponse.json({ 
      videoId, 
      title: basicInfo.title,
      thumbnail: thumbnail,
      fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: basicInfo.duration,
      author: basicInfo.author
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


