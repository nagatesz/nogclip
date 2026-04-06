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
  italic?: boolean;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
}

export const GOOGLE_FONTS = [
  "Inter",
  "Montserrat",
  "Bangers",
  "Oswald",
  "Poppins",
  "Roboto",
  "Bebas Neue",
  "Permanent Marker",
  "Pacifico",
  "Anton",
  "Black Ops One",
  "Bungee",
  "Archivo Black",
  "Righteous",
];

export const CAPTION_PRESETS: CaptionStyle[] = [
  {
    id: "bold-pop",
    name: "Bold Pop",
    fontFamily: "Montserrat",
    fontSize: 52,
    fontWeight: "900",
    primaryColor: "#FFFFFF",
    highlightColor: "#FFD700",
    outlineColor: "#000000",
    outlineWidth: 4,
    shadowColor: "rgba(0,0,0,0.9)",
    position: "bottom",
    animation: "pop",
  },
  {
    id: "karaoke",
    name: "Karaoke",
    fontFamily: "Poppins",
    fontSize: 48,
    fontWeight: "800",
    primaryColor: "#FFFFFF",
    highlightColor: "#8b5cf6",
    outlineColor: "#000000",
    outlineWidth: 3,
    shadowColor: "rgba(0,0,0,0.7)",
    position: "bottom",
    animation: "karaoke",
  },
  {
    id: "typewriter",
    name: "Typewriter",
    fontFamily: "JetBrains Mono",
    fontSize: 40,
    fontWeight: "600",
    primaryColor: "#00FF88",
    highlightColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 2,
    shadowColor: "rgba(0,0,0,0.8)",
    position: "center",
    animation: "typewriter",
  },
  {
    id: "minimal",
    name: "Minimal",
    fontFamily: "Inter",
    fontSize: 38,
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
    id: "fire",
    name: "Fire 🔥",
    fontFamily: "Bangers",
    fontSize: 56,
    fontWeight: "400",
    primaryColor: "#FF6B35",
    highlightColor: "#FFD700",
    outlineColor: "#000000",
    outlineWidth: 4,
    shadowColor: "rgba(255,100,0,0.5)",
    position: "bottom",
    animation: "pop",
  },
  {
    id: "neon",
    name: "Neon Glow",
    fontFamily: "Bebas Neue",
    fontSize: 54,
    fontWeight: "400",
    primaryColor: "#00FFFF",
    highlightColor: "#FF00FF",
    outlineColor: "#000033",
    outlineWidth: 2,
    shadowColor: "rgba(0,255,255,0.6)",
    position: "bottom",
    animation: "karaoke",
  },
  {
    id: "none",
    name: "No Captions",
    fontFamily: "Inter",
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

// Load Google Font dynamically
const loadedFonts = new Set<string>();

export function loadGoogleFont(fontFamily: string): void {
  if (loadedFonts.has(fontFamily)) return;
  loadedFonts.add(fontFamily);

  const link = document.createElement("link");
  link.href = `https://fonts.googleapis.com/css2?family=${fontFamily.replace(/ /g, "+")}:wght@400;500;600;700;800;900&display=swap`;
  link.rel = "stylesheet";
  document.head.appendChild(link);
}

// Get current words to display based on time
export function getCurrentCaptionChunk(
  words: TranscriptWord[],
  currentTime: number,
  maxWords: number = 5
): { words: TranscriptWord[]; activeIndex: number } | null {
  if (words.length === 0) return null;

  // Find the active word
  let activeWordIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTime >= words[i].start && currentTime <= words[i].end + 0.1) {
      activeWordIdx = i;
      break;
    }
  }

  // If between words, find the next upcoming word
  if (activeWordIdx === -1) {
    for (let i = 0; i < words.length; i++) {
      if (words[i].start > currentTime) {
        // Check if we're in the gap — show previous chunk
        if (i > 0 && currentTime - words[i - 1].end < 0.5) {
          activeWordIdx = i - 1;
        }
        break;
      }
    }
  }

  if (activeWordIdx === -1) return null;

  // Build chunk around active word (show context)
  const chunks = buildWordChunks(words, maxWords);
  for (const chunk of chunks) {
    const chunkStart = chunk[0].start;
    const chunkEnd = chunk[chunk.length - 1].end;
    if (currentTime >= chunkStart - 0.05 && currentTime <= chunkEnd + 0.05) {
      const activeInChunk = chunk.findIndex(
        (w) => currentTime >= w.start && currentTime <= w.end + 0.1
      );
      return { words: chunk, activeIndex: Math.max(0, activeInChunk) };
    }
  }

  return null;
}

function buildWordChunks(
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

// Render live captions on a canvas overlay
export function renderLiveCaptions(
  ctx: CanvasRenderingContext2D,
  words: TranscriptWord[],
  currentTime: number,
  style: CaptionStyle,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (style.id === "none" || words.length === 0) return;

  const chunk = getCurrentCaptionChunk(words, currentTime);
  if (!chunk) return;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const scale = canvasWidth / 1080;
  const configScale = style.scale || 1;
  const fontSize = Math.round(style.fontSize * scale * configScale);
  const fontStyle = style.italic ? "italic " : "";
  ctx.font = `${fontStyle}${style.fontWeight} ${fontSize}px ${style.fontFamily}, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let y: number;
  if (style.position === "bottom") y = canvasHeight * 0.82;
  else if (style.position === "top") y = canvasHeight * 0.15;
  else y = canvasHeight * 0.5;
  
  if (style.offsetY) y += style.offsetY * canvasHeight;
  let baseX = canvasWidth / 2;
  if (style.offsetX) baseX += style.offsetX * canvasWidth;

  const fullText = chunk.words.map((w) => w.word).join(" ");
  const textMetrics = ctx.measureText(fullText);

  // Background pill for readability
  const padding = 16 * scale * configScale;
  const bgX = baseX - textMetrics.width / 2 - padding;
  const bgY = y - fontSize / 2 - padding / 2;
  const bgW = textMetrics.width + padding * 2;
  const bgH = fontSize + padding;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  const radius = 12 * scale;
  ctx.beginPath();
  ctx.roundRect(bgX, bgY, bgW, bgH, radius);
  ctx.fill();

  // Draw each word
  let xPos = baseX - textMetrics.width / 2;

  for (let i = 0; i < chunk.words.length; i++) {
    const word = chunk.words[i];
    const isActive = i === chunk.activeIndex;
    const isPast = i < chunk.activeIndex;
    const wordText = word.word + (i < chunk.words.length - 1 ? " " : "");
    const wordWidth = ctx.measureText(wordText).width;

    // Shadow
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = isActive ? 12 * scale : 6 * scale;
    ctx.shadowOffsetX = 2 * scale;
    ctx.shadowOffsetY = 2 * scale;

    // Outline
    if (style.outlineWidth > 0) {
      ctx.strokeStyle = style.outlineColor;
      ctx.lineWidth = style.outlineWidth * 2 * scale;
      ctx.lineJoin = "round";
      ctx.strokeText(wordText, xPos + wordWidth / 2, y);
    }

    // Fill — active word gets highlight color + scale effect
    if (isActive) {
      // Scale animation for active word
      if (style.animation === "pop") {
        const progress = Math.min(
          1,
          (currentTime - word.start) / Math.max(0.1, word.end - word.start)
        );
        const popScale = 1 + Math.sin(progress * Math.PI) * 0.08;
        ctx.save();
        ctx.translate(xPos + wordWidth / 2, y);
        ctx.scale(popScale, popScale);
        ctx.fillStyle = word.color || style.highlightColor;
        ctx.fillText(wordText, 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = word.color || style.highlightColor;
        ctx.fillText(wordText, xPos + wordWidth / 2, y);
      }
    } else if (isPast) {
      ctx.fillStyle = word.color || style.primaryColor;
      ctx.fillText(wordText, xPos + wordWidth / 2, y);
    } else {
      // Upcoming words — slightly dimmer
      ctx.fillStyle = word.color ? word.color + "CC" : style.primaryColor + "CC";
      ctx.fillText(wordText, xPos + wordWidth / 2, y);
    }

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    xPos += wordWidth;
  }
}

// ASS subtitle generation (for export)
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
Style: Default,${style.fontFamily},${style.fontSize},${hexToASS(style.primaryColor)},${hexToASS(style.highlightColor)},${hexToASS(style.outlineColor)},&H80000000&,${style.fontWeight === "bold" || parseInt(style.fontWeight) >= 700 ? 1 : 0},0,0,0,100,100,0,0,1,${style.outlineWidth},1,${alignment},40,40,${marginV},1
Style: Highlight,${style.fontFamily},${Math.round(style.fontSize * 1.1)},${hexToASS(style.highlightColor)},${hexToASS(style.primaryColor)},${hexToASS(style.outlineColor)},&H80000000&,1,0,0,0,100,100,0,0,1,${style.outlineWidth + 1},2,${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const chunks = buildWordChunks(words, 5);

  for (const chunk of chunks) {
    const startTime = formatASSTime(chunk[0].start);
    const endTime = formatASSTime(chunk[chunk.length - 1].end);

    if (style.animation === "karaoke") {
      let karaokeText = "";
      for (let i = 0; i < chunk.length; i++) {
        const wordDur = Math.round((chunk[i].end - chunk[i].start) * 100);
        karaokeText += `{\\kf${wordDur}}${chunk[i].word} `;
      }
      ass += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${karaokeText.trim()}\n`;
    } else if (style.animation === "pop") {
      for (let i = 0; i < chunk.length; i++) {
        const wStart = formatASSTime(chunk[i].start);
        const wEnd = formatASSTime(
          chunk[Math.min(i + 2, chunk.length - 1)].end
        );
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

  const fontSize = Math.round(style.fontSize * (canvasWidth / 1080));
  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let y: number;
  if (style.position === "bottom") y = canvasHeight * 0.85;
  else if (style.position === "top") y = canvasHeight * 0.15;
  else y = canvasHeight * 0.5;

  const x = canvasWidth / 2;

  ctx.shadowColor = style.shadowColor;
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  if (style.outlineWidth > 0) {
    ctx.strokeStyle = style.outlineColor;
    ctx.lineWidth = style.outlineWidth * 2;
    ctx.lineJoin = "round";
    ctx.strokeText(word, x, y);
  }

  ctx.fillStyle = highlighted ? style.highlightColor : style.primaryColor;
  ctx.fillText(word, x, y);

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}
