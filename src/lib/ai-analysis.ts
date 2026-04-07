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
  videoDuration: number,
  onProgress?: (msg: string) => void
): Promise<AnalysisResult> {
  const CHUNK_DURATION = 600; // 10 minutes per chunk
 // Split segments into 10 minute windows
  const chunks: TranscriptSegment[][] = [];
  let currentChunk: TranscriptSegment[] = [];
  let currentChunkStart = 0;

  for (const seg of segments) {
    if (seg.end - currentChunkStart > CHUNK_DURATION && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChunkStart = seg.start;
    }
    currentChunk.push(seg);
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  let allClips: ClipSuggestion[] = [];
  let summary = "";

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Analyzing part ${i + 1} of ${chunks.length}...`);
    
    const chunkSegments = chunks[i];
    const transcriptText = chunkSegments
      .map((s) => `[${formatTime(s.start)} - ${formatTime(s.end)}] ${s.text}`)
      .join("\n");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptText,
          duration: chunkSegments[chunkSegments.length - 1].end - chunkSegments[0].start,
          segmentCount: chunkSegments.length,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawClips = data.clips || [];
        summary = data.summary || summary; // Keep the last summary

        // Map words to clips
        const enrichedClips = rawClips.map((clip: any, clipIdx: number) => ({
          ...clip,
          id: `clip-${i}-${clipIdx}-${Date.now()}`,
          words: words.filter((w) => w.start >= clip.start && w.end <= clip.end),
          text: segments
            .filter((s) => s.start >= clip.start - 0.5 && s.end <= clip.end + 0.5)
            .map((s) => s.text)
            .join(" "),
        }));

        allClips = [...allClips, ...enrichedClips];
      }
    } catch (err) {
      console.warn("Error analyzing chunk:", err);
    }
  }

  return {
    clips: allClips.sort((a, b) => b.viralityScore - a.viralityScore),
    summary,
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
