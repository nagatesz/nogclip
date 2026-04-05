import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY not configured. Add it to your .env.local file." },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Forward to Groq Whisper API
    const groqFormData = new FormData();
    groqFormData.append("file", file, "audio.wav");
    groqFormData.append("model", "whisper-large-v3");
    groqFormData.append("response_format", "verbose_json");
    groqFormData.append("timestamp_granularities[]", "word");
    groqFormData.append("timestamp_granularities[]", "segment");
    groqFormData.append("language", "en");

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: groqFormData,
      }
    );

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("Groq API error:", errorText);
      return NextResponse.json(
        { error: `Groq API error: ${groqResponse.status}` },
        { status: groqResponse.status }
      );
    }

    const result = await groqResponse.json();

    // Normalize the response
    const normalized = {
      text: result.text || "",
      segments: (result.segments || []).map(
        (s: { text: string; start: number; end: number; words?: Array<{ word: string; start: number; end: number }> }) => ({
          text: s.text?.trim() || "",
          start: s.start || 0,
          end: s.end || 0,
          words: (s.words || []).map(
            (w: { word: string; start: number; end: number }) => ({
              word: w.word?.trim() || "",
              start: w.start || 0,
              end: w.end || 0,
            })
          ),
        })
      ),
      words: (result.words || []).map(
        (w: { word: string; start: number; end: number }) => ({
          word: w.word?.trim() || "",
          start: w.start || 0,
          end: w.end || 0,
        })
      ),
      language: result.language || "en",
      duration: result.duration || 0,
    };

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: "Internal server error during transcription" },
      { status: 500 }
    );
  }
}
