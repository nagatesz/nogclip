import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured. Add it to your .env.local file." },
        { status: 500 }
      );
    }

    const { transcript, duration, segmentCount } = await request.json();

    if (!transcript) {
      return NextResponse.json(
        { error: "No transcript provided" },
        { status: 400 }
      );
    }

    const prompt = `You are an expert social media content strategist and video editor. Analyze this video transcript and identify the best clips for TikTok, YouTube Shorts, and Instagram Reels.

VIDEO INFO:
- Total duration: ${duration} seconds (${Math.round(duration / 60)} minutes)
- Total segments: ${segmentCount}

TRANSCRIPT (with timestamps):
${transcript}

TASK: Identify 3-8 of the BEST short-form clips (15-60 seconds each) from this transcript. For each clip:

1. Find segments that would make compelling standalone content
2. Look for:
   - Strong hooks (attention-grabbing openings)
   - Emotional moments or surprising statements
   - Educational/informative nuggets
   - Funny or entertaining moments
   - Controversial or thought-provoking takes
   - Story arcs that work in isolation

3. Assign a virality score (0-100) based on:
   - Hook strength (first 3 seconds)
   - Emotional impact
   - Shareability
   - Trending topic alignment
   - Pacing and energy

RESPOND IN EXACTLY THIS JSON FORMAT (no markdown, no code blocks, just raw JSON):
{
  "clips": [
    {
      "title": "Short catchy title for the clip",
      "start": 0.0,
      "end": 30.0,
      "viralityScore": 85,
      "reason": "Why this clip would perform well",
      "hookStrength": "strong",
      "emotionalPeak": true
    }
  ],
  "summary": "Brief overall assessment of the video's clip potential"
}

IMPORTANT RULES:
- Start and end times MUST match the timestamps from the transcript
- Each clip should be 15-60 seconds long
- Clips should not overlap significantly
- hookStrength must be one of: "weak", "medium", "strong"
- viralityScore must be 0-100
- Return valid JSON only, no additional text`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", errorText);
      return NextResponse.json(
        { error: `Gemini API error: ${geminiResponse.status}` },
        { status: geminiResponse.status }
      );
    }

    const geminiData = await geminiResponse.json();

    // Extract text from Gemini response
    let responseText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Clean up the response - remove markdown code blocks if present
    responseText = responseText
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    try {
      const parsed = JSON.parse(responseText);
      return NextResponse.json(parsed);
    } catch {
      console.error("Failed to parse Gemini response:", responseText);
      // Return a fallback response
      return NextResponse.json({
        clips: [],
        summary:
          "AI analysis could not parse the results. Please try again.",
      });
    }
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: "Internal server error during analysis" },
      { status: 500 }
    );
  }
}
