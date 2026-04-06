export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  color?: string;
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
  "um", "uh", "umm", "uhh", "er", "err", "ah", "ahh", "eh",
  "like", "you know", "i mean", "basically", "literally",
  "actually", "right", "so", "well",
]);

// Max body size for Vercel functions is 4.5MB. 
// 5 minutes of 64kbps MP3 is ~2.4MB.
const MAX_CHUNK_DURATION = 300; // 5 minutes per chunk

export async function transcribeAudio(
  audioBlob: Blob
): Promise<TranscriptionResult> {
  // Check audio size — if > 4MB or duration is likely long, chunk it
  if (audioBlob.size > 4 * 1024 * 1024) {
    return transcribeChunked(audioBlob);
  }

  // Single-shot transcription for short videos
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.mp3");

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

async function transcribeChunked(
  audioBlob: Blob
): Promise<TranscriptionResult> {
  // For long videos: estimate duration from mp3 size roughly
  // 64kbps MP3 = 8000 bytes/sec
  const estimatedDuration = audioBlob.size / 8000;
  const numChunks = Math.ceil(estimatedDuration / MAX_CHUNK_DURATION);

  const allSegments: TranscriptSegment[] = [];
  const allWords: TranscriptWord[] = [];
  let fullText = "";
  let language = "en";

  const chunkSize = Math.ceil(audioBlob.size / numChunks);

  for (let i = 0; i < numChunks; i++) {
    const startByte = i * chunkSize;
    const endByte = Math.min((i + 1) * chunkSize, audioBlob.size);
    const timeOffset = i * MAX_CHUNK_DURATION;

    // For raw MP3, we can just slice the blob and send it
    const chunkBlob = audioBlob.slice(startByte, endByte, "audio/mp3");

    const formData = new FormData();
    formData.append("file", chunkBlob, `audio_chunk_${i}.mp3`);

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        console.warn(`Chunk ${i + 1}/${numChunks} transcription failed`);
        continue;
      }

      const result: TranscriptionResult = await response.json();
      language = result.language || language;

      // Offset all timestamps by the chunk's time offset
      const offsetSegments = result.segments.map((seg) => ({
        ...seg,
        start: seg.start + timeOffset,
        end: seg.end + timeOffset,
        words: seg.words.map((w) => ({
          ...w,
          start: w.start + timeOffset,
          end: w.end + timeOffset,
        })),
      }));

      const offsetWords = result.words.map((w) => ({
        ...w,
        start: w.start + timeOffset,
        end: w.end + timeOffset,
      }));

      allSegments.push(...offsetSegments);
      allWords.push(...offsetWords);
      fullText += (fullText ? " " : "") + result.text;
    } catch (e) {
      console.warn(`Chunk ${i + 1}/${numChunks} error:`, e);
    }
  }

  return {
    text: fullText,
    segments: allSegments,
    words: allWords,
    language,
    duration: estimatedDuration,
  };
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
