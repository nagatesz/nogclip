import { TranscriptWord } from "./transcription";

export interface CaptionStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadowColor: string;
  position: "bottom" | "center" | "top";
  animation: "pop" | "typewriter" | "karaoke" | "fade" | "none";
}

export const CAPTION_PRESETS: CaptionStyle[] = [
  {
    id: "bold-pop",
    name: "Bold Pop",
    fontFamily: "Arial",
    fontSize: 48,
    fontWeight: "bold",
    primaryColor: "#FFFFFF",
    highlightColor: "#FFD700",
    outlineColor: "#000000",
    outlineWidth: 3,
    shadowColor: "rgba(0,0,0,0.8)",
    position: "bottom",
    animation: "pop",
  },
  {
    id: "karaoke",
    name: "Karaoke",
    fontFamily: "Arial",
    fontSize: 44,
    fontWeight: "bold",
    primaryColor: "#FFFFFF",
    highlightColor: "#8b5cf6",
    outlineColor: "#000000",
    outlineWidth: 2,
    shadowColor: "rgba(0,0,0,0.6)",
    position: "bottom",
    animation: "karaoke",
  },
  {
    id: "typewriter",
    name: "Typewriter",
    fontFamily: "Courier New",
    fontSize: 40,
    fontWeight: "normal",
    primaryColor: "#00FF88",
    highlightColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 2,
    shadowColor: "rgba(0,0,0,0.7)",
    position: "center",
    animation: "typewriter",
  },
  {
    id: "minimal",
    name: "Minimal",
    fontFamily: "Helvetica",
    fontSize: 36,
    fontWeight: "500",
    primaryColor: "#FFFFFF",
    highlightColor: "#06b6d4",
    outlineColor: "#000000",
    outlineWidth: 1,
    shadowColor: "rgba(0,0,0,0.5)",
    position: "bottom",
    animation: "fade",
  },
  {
    id: "none",
    name: "No Captions",
    fontFamily: "Arial",
    fontSize: 0,
    fontWeight: "normal",
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 0,
    shadowColor: "transparent",
    position: "bottom",
    animation: "none",
  },
];

export function generateASSSubtitles(
  words: TranscriptWord[],
  style: CaptionStyle,
  videoWidth: number = 1080,
  videoHeight: number = 1920
): string {
  if (style.id === "none" || words.length === 0) return "";

  const hexToASS = (hex: string): string => {
    const r = hex.slice(1, 3);
    const g = hex.slice(3, 5);
    const b = hex.slice(5, 7);
    return `&H00${b}${g}${r}&`;
  };

  const marginV =
    style.position === "bottom"
      ? Math.round(videoHeight * 0.12)
      : style.position === "top"
        ? Math.round(videoHeight * 0.85)
        : Math.round(videoHeight * 0.45);

  const alignment =
    style.position === "bottom" ? 2 : style.position === "top" ? 8 : 5;

  let ass = `[Script Info]
Title: nogclip captions
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${style.fontSize},${hexToASS(style.primaryColor)},${hexToASS(style.highlightColor)},${hexToASS(style.outlineColor)},&H80000000&,${style.fontWeight === "bold" ? 1 : 0},0,0,0,100,100,0,0,1,${style.outlineWidth},1,${alignment},40,40,${marginV},1
Style: Highlight,${style.fontFamily},${Math.round(style.fontSize * 1.1)},${hexToASS(style.highlightColor)},${hexToASS(style.primaryColor)},${hexToASS(style.outlineColor)},&H80000000&,1,0,0,0,100,100,0,0,1,${style.outlineWidth + 1},2,${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Group words into chunks of ~4-6 words for display
  const chunks = chunkWords(words, 5);

  for (const chunk of chunks) {
    const startTime = formatASSTime(chunk[0].start);
    const endTime = formatASSTime(chunk[chunk.length - 1].end);

    if (style.animation === "karaoke") {
      // Karaoke: each word highlights as it's spoken
      let karaokeText = "";
      for (let i = 0; i < chunk.length; i++) {
        const wordDur = Math.round(
          (chunk[i].end - chunk[i].start) * 100
        );
        karaokeText += `{\\kf${wordDur}}${chunk[i].word} `;
      }
      ass += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${karaokeText.trim()}\n`;
    } else if (style.animation === "pop") {
      // Pop: words appear one at a time with scale animation
      for (let i = 0; i < chunk.length; i++) {
        const wStart = formatASSTime(chunk[i].start);
        const wEnd = formatASSTime(chunk[Math.min(i + 2, chunk.length - 1)].end);
        const text = chunk
          .slice(0, i + 1)
          .map((w) => w.word)
          .join(" ");
        ass += `Dialogue: 0,${wStart},${wEnd},Default,,0,0,0,,{\\fad(100,0)}${text}\n`;
      }
    } else if (style.animation === "typewriter") {
      const text = chunk.map((w) => w.word).join(" ");
      ass += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,{\\fad(0,200)}${text}\n`;
    } else {
      const text = chunk.map((w) => w.word).join(" ");
      ass += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,{\\fad(150,150)}${text}\n`;
    }
  }

  return ass;
}

function chunkWords(
  words: TranscriptWord[],
  maxPerChunk: number
): TranscriptWord[][] {
  const chunks: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];

  for (const word of words) {
    current.push(word);
    if (
      current.length >= maxPerChunk ||
      (current.length > 2 && word.end - current[0].start > 3)
    ) {
      chunks.push([...current]);
      current = [];
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function renderCaptionPreview(
  ctx: CanvasRenderingContext2D,
  word: string,
  style: CaptionStyle,
  canvasWidth: number,
  canvasHeight: number,
  highlighted: boolean = false
): void {
  if (style.id === "none") return;

  const fontSize = Math.round(
    style.fontSize * (canvasWidth / 1080)
  );
  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let y: number;
  if (style.position === "bottom") y = canvasHeight * 0.85;
  else if (style.position === "top") y = canvasHeight * 0.15;
  else y = canvasHeight * 0.5;

  const x = canvasWidth / 2;

  // Shadow
  ctx.shadowColor = style.shadowColor;
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  // Outline
  if (style.outlineWidth > 0) {
    ctx.strokeStyle = style.outlineColor;
    ctx.lineWidth = style.outlineWidth * 2;
    ctx.lineJoin = "round";
    ctx.strokeText(word, x, y);
  }

  // Fill
  ctx.fillStyle = highlighted
    ? style.highlightColor
    : style.primaryColor;
  ctx.fillText(word, x, y);

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}
