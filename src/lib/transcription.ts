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

// Max audio size for Groq = ~25MB -> ~13 min at 16kHz mono 16-bit WAV
const MAX_CHUNK_DURATION = 600; // 10 minutes per chunk (safe margin)

export async function transcribeAudio(
  audioBlob: Blob
): Promise<TranscriptionResult> {
  // Check audio size — if > 20MB, need to chunk
  if (audioBlob.size > 20 * 1024 * 1024) {
    return transcribeChunked(audioBlob);
  }

  // Single-shot transcription for short videos
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

async function transcribeChunked(
  audioBlob: Blob
): Promise<TranscriptionResult> {
  // For long videos: estimate duration from blob size
  // 16kHz, 16-bit mono WAV = 32000 bytes/sec + 44 byte header
  const estimatedDuration = (audioBlob.size - 44) / 32000;
  const numChunks = Math.ceil(estimatedDuration / MAX_CHUNK_DURATION);

  const allSegments: TranscriptSegment[] = [];
  const allWords: TranscriptWord[] = [];
  let fullText = "";
  let language = "en";

  const chunkSize = Math.ceil(audioBlob.size / numChunks);

  for (let i = 0; i < numChunks; i++) {
    const startByte = i === 0 ? 0 : i * chunkSize;
    const endByte = Math.min((i + 1) * chunkSize, audioBlob.size);
    const timeOffset = i * MAX_CHUNK_DURATION;

    // Build a proper WAV header for each chunk with correct byte sizes
    let chunkBlob: Blob;
    if (i === 0) {
      chunkBlob = audioBlob.slice(0, endByte);
    } else {
      const audioData = audioBlob.slice(startByte, endByte);
      const audioDataSize = endByte - startByte;
      // Build a valid 44-byte WAV header: 16kHz, 16-bit, mono
      const header = new ArrayBuffer(44);
      const view = new DataView(header);
      const writeStr = (offset: number, str: string) => { for (let c = 0; c < str.length; c++) view.setUint8(offset + c, str.charCodeAt(c)); };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + audioDataSize, true);       // file size - 8
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);                       // fmt chunk size
      view.setUint16(20, 1, true);                        // PCM format
      view.setUint16(22, 1, true);                        // mono
      view.setUint32(24, 16000, true);                    // sample rate
      view.setUint32(28, 16000 * 2, true);                // byte rate (16kHz * 16bit/8 * 1ch)
      view.setUint16(32, 2, true);                        // block align
      view.setUint16(34, 16, true);                       // bits per sample
      writeStr(36, "data");
      view.setUint32(40, audioDataSize, true);            // data chunk size
      chunkBlob = new Blob([header, audioData], { type: "audio/wav" });
    }

    const formData = new FormData();
    formData.append("file", chunkBlob, `audio_chunk_${i}.wav`);

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
