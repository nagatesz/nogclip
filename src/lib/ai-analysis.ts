import { TranscriptSegment, TranscriptWord } from "./transcription";

export interface ClipSuggestion {
  id: string;
  title: string;
  start: number;
  end: number;
  viralityScore: number;
  reason: string;
  hookStrength: "weak" | "medium" | "strong";
  emotionalPeak: boolean;
  words: TranscriptWord[];
  text: string;
}

export interface AnalysisResult {
  clips: ClipSuggestion[];
  summary: string;
}

export async function analyzeTranscript(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
  videoDuration: number
): Promise<AnalysisResult> {
  const transcriptText = segments
    .map(
      (s) =>
        `[${formatTime(s.start)} - ${formatTime(s.end)}] ${s.text}`
    )
    .join("\n");

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript: transcriptText,
      duration: videoDuration,
      segmentCount: segments.length,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Analysis failed: ${err}`);
  }

  const data = await response.json();

  // Enrich clips with word data
  const clips: ClipSuggestion[] = (data.clips || []).map(
    (clip: ClipSuggestion, i: number) => ({
      ...clip,
      id: `clip-${i}-${Date.now()}`,
      words: words.filter(
        (w) => w.start >= clip.start && w.end <= clip.end
      ),
      text: segments
        .filter(
          (s) =>
            s.start >= clip.start - 0.5 && s.end <= clip.end + 0.5
        )
        .map((s) => s.text)
        .join(" "),
    })
  );

  return {
    clips: clips.sort((a, b) => b.viralityScore - a.viralityScore),
    summary: data.summary || "",
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function getViralityColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

export function getViralityLabel(score: number): string {
  if (score >= 80) return "🔥 High Viral Potential";
  if (score >= 60) return "⚡ Good Potential";
  if (score >= 40) return "📈 Moderate";
  return "📉 Low";
}
