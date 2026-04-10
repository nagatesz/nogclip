import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10; 

interface CobaltResponse {
  status: string;
  url?: string;
  text?: string;
  picker?: Array<{ url: string; type: string }>;
}

/**
 * Community Instances (Updated list without blocked official api.cobalt.tools)
 */
const COBALT_INSTANCES = [
  "https://co.eepy.ovh/",
  "https://cobalt.squair.xyz/",
  "https://dl.woof.monster/",
  "https://cobalt.clxxped.lol/",
  "https://cobalt.meowing.de/",
  "https://cobalt.blackcat.sweeux.org/",
];

async function fetchFromCobalt(videoUrl: string, options: any = {}): Promise<CobaltResponse | null> {
  const bodyPayload = JSON.stringify({ 
    url: videoUrl, 
    ...options,
    filenameStyle: "pretty", // Compatibility
  });
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6500); // 6.5s race timeout

  try {
    const promises = COBALT_INSTANCES.map(async (instance) => {
      try {
        const res = await fetch(instance, {
          method: "POST",
          headers: { 
            Accept: "application/json", 
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Nogclip/1.1)" 
          },
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

    return await Promise.any(promises);
  } catch (err) {
    console.error("Ingestion failed: all instances rejected or timed out.");
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url, proxyStream } = await request.json();
    if (!url) return NextResponse.json({ error: "No URL provided" }, { status: 400 });

    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = idMatch?.[1];
    if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

    // Cobalt v11+ Parameters
    const requestOptions = proxyStream ? {
      videoQuality: "1080",
    } : { 
      downloadMode: "audio", 
      audioFormat: "mp3",
      isAudioOnly: true 
    };

    const cobaltData = await fetchFromCobalt(url, requestOptions);
    
    if (!cobaltData?.url) {
      return NextResponse.json({ error: "Inlet blocked or timeout. Try pasting again in 10s." }, { status: 502 });
    }

    if (!proxyStream) return NextResponse.json({ url: cobaltData.url, status: "ok" });

    // PROXY bytes (mostly for studio previews)
    const videoRes = await fetch(cobaltData.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(50000), 
    });
    
    if (!videoRes.ok) return NextResponse.json({ error: "Stream unavailable" }, { status: 502 });

    const contentType = videoRes.headers.get("content-type") || "video/mp4";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    };
    return new NextResponse(videoRes.body, { status: 200, headers });
  } catch (error) {
    console.error("YouTube download error:", error);
    return NextResponse.json({ error: "Gateway Fault" }, { status: 500 });
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
    
    return NextResponse.json({ 
      videoId, 
      title: "YouTube Video", // Frontend will update this later via metadata if available
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      fallbackThumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    });
  } catch (error) {
    return NextResponse.json({ error: "Metadata Fault" }, { status: 500 });
  }
}

