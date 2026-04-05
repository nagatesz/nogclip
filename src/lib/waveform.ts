export async function generateWaveform(
  audioBlob: Blob,
  numSamples: number = 200
): Promise<number[]> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const channelData = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(channelData.length / numSamples);
  const waveform: number[] = [];

  for (let i = 0; i < numSamples; i++) {
    let sum = 0;
    const start = i * blockSize;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(channelData[start + j] || 0);
    }
    waveform.push(sum / blockSize);
  }

  // Normalize to 0-1
  const max = Math.max(...waveform, 0.001);
  return waveform.map((v) => v / max);

}

export function renderWaveform(
  canvas: HTMLCanvasElement,
  waveform: number[],
  options: {
    color?: string;
    activeColor?: string;
    backgroundColor?: string;
    progress?: number;
    selectionStart?: number;
    selectionEnd?: number;
    selectionColor?: string;
  } = {}
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const {
    color = "rgba(139, 92, 246, 0.5)",
    activeColor = "#8b5cf6",
    backgroundColor = "transparent",
    progress = 0,
    selectionStart,
    selectionEnd,
    selectionColor = "rgba(139, 92, 246, 0.15)",
  } = options;

  const { width, height } = canvas;
  const barWidth = width / waveform.length;
  const halfHeight = height / 2;

  ctx.clearRect(0, 0, width, height);

  if (backgroundColor !== "transparent") {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  // Selection highlight
  if (selectionStart !== undefined && selectionEnd !== undefined) {
    const sx = selectionStart * width;
    const sw = (selectionEnd - selectionStart) * width;
    ctx.fillStyle = selectionColor;
    ctx.fillRect(sx, 0, sw, height);
  }

  // Draw waveform bars
  const progressX = progress * width;

  for (let i = 0; i < waveform.length; i++) {
    const x = i * barWidth;
    const barHeight = Math.max(2, waveform[i] * halfHeight * 0.9);

    ctx.fillStyle = x < progressX ? activeColor : color;
    ctx.beginPath();
    ctx.roundRect(
      x + 1,
      halfHeight - barHeight,
      Math.max(1, barWidth - 2),
      barHeight * 2,
      2
    );
    ctx.fill();
  }

  // Playhead
  if (progress > 0 && progress < 1) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, height);
    ctx.stroke();
  }
}
