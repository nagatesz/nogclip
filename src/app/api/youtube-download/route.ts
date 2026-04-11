import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * YouTube download API using multiple services
 * Users can choose between Cobalt API, yt1s API, or manual upload
 */

const COBALT_INSTANCES = [
  "https://api.cobalt.tools/",
  "https://cobalt-api.kwiatekmiki.com/",
  "https://co.eepy.ovh/",
  "https://cobaltapi.cjs.nz/",
  "https://api.dl.woof.monster/",
];

async function tryCobaltAPI(url: string) {
  for (const instance of COBALT_INSTANCES) {
    try {
      const res = await fetch(instance, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ 
          url, 
          downloadMode: "auto",
          videoQuality: "1080",
          filenameStyle: "basic"
        }),
        signal: AbortSignal.timeout(15000),
      });
      
      if (!res.ok) continue;
      
      const data = await res.json();
      if (data.status === "error") continue;
      if (data.url && !data.url.includes("youtube.com/watch") && !data.url.includes("youtu.be")) {
        return {
          url: data.url,
          title: data.filename || "YouTube Video",
          thumbnail: data.thumbnail,
        };
      }
    } catch (e) {
      console.error(`Cobalt instance ${instance} failed:`, e);
      continue;
    }
  }
  return null;
}

async function tryYt1sAPI(url: string) {
  try {
    // yt1s.com API endpoint
    const apiUrl = "https://yt1s.com/api/ajaxSearch/index";
    const formData = new URLSearchParams();
    formData.append("q", url);
    formData.append("vt", "home");
    
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
      signal: AbortSignal.timeout(15000),
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    if (data.links && data.links.mp4) {
      // Get the best quality
      const mp4Links = data.links.mp4;
      const qualities = Object.keys(mp4Links);
      if (qualities.length === 0) return null;
      
      const bestQuality = qualities[qualities.length - 1];
      const videoUrl = mp4Links[bestQuality].url;
      
      if (videoUrl && !videoUrl.includes("youtube.com/watch") && !videoUrl.includes("youtu.be")) {
        return {
          url: videoUrl,
          title: data.title || "YouTube Video",
          thumbnail: data.thumbnail,
        };
      }
    }
  } catch (e) {
    console.error("yt1s API failed:", e);
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { url, service = "cobalt" } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid URL" }, { status: 400 });

    if (service === "cobalt") {
      const result = await tryCobaltAPI(url);
      if (result) {
        return NextResponse.json({ 
          url: result.url,
          title: result.title,
          thumbnail: result.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          status: "ok",
          useProxy: false
        });
      }
      
      return NextResponse.json({ 
        error: "Cobalt API failed. Try switching to yt1s API or Manual Upload." 
      }, { status: 400 });
    }

    if (service === "yt1s") {
      const result = await tryYt1sAPI(url);
      if (result) {
        return NextResponse.json({ 
          url: result.url,
          title: result.title,
          thumbnail: result.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          status: "ok",
          useProxy: false
        });
      }
      
      return NextResponse.json({ 
        error: "yt1s API failed. Try switching to Cobalt API or Manual Upload." 
      }, { status: 400 });
    }

    // Manual service - just return metadata
    try {
      const oRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(5000) });
      if (oRes.ok) {
        const data = await oRes.json();
        return NextResponse.json({ 
          url: url,
          title: data.title || "YouTube Video",
          thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          status: "ok",
          useProxy: false
        });
      }
    } catch {}

    return NextResponse.json({ 
      url: url,
      title: "YouTube Video",
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      status: "ok",
      useProxy: false
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


