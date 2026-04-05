export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words: TranscriptWord[];
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  language: string;
  duration: number;
}

const FILLER_WORDS = new Set([
  "um",
  "uh",
  "umm",
  "uhh",
  "er",
  "err",
  "ah",
  "ahh",
  "eh",
  "like",
  "you know",
  "i mean",
  "basically",
  "literally",
  "actually",
  "right",
  "so",
  "well",
]);

export async function transcribeAudio(
  audioBlob: Blob
): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.wav");

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Transcription failed: ${err}`);
  }

  return await response.json();
}

export function detectFillerWords(
  words: TranscriptWord[]
): Array<{ word: TranscriptWord; index: number }> {
  const fillers: Array<{ word: TranscriptWord; index: number }> = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].word.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    if (FILLER_WORDS.has(w)) {
      fillers.push({ word: words[i], index: i });
    }
  }
  return fillers;
}

export function getFillerRegions(
  words: TranscriptWord[],
  paddingMs: number = 50
): Array<{ start: number; end: number }> {
  const fillers = detectFillerWords(words);
  return fillers.map((f) => ({
    start: Math.max(0, f.word.start - paddingMs / 1000),
    end: f.word.end + paddingMs / 1000,
  }));
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

export function segmentsToSRT(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, i) => {
      const startTime = formatSRTTime(seg.start);
      const endTime = formatSRTTime(seg.end);
      return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text}\n`;
    })
    .join("\n");
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}
