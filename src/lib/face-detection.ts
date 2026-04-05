/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FaceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

export interface FaceFrame {
  time: number;
  faces: FaceRegion[];
}

export interface FaceTrackingResult {
  frames: FaceFrame[];
  maxFaces: number;
  averageFaces: number;
}

let modelsLoaded = false;
let faceapi: any = null;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;

  try {
    faceapi = await import("face-api.js");
    const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/";

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    ]);

    modelsLoaded = true;
  } catch (e) {
    console.error("Failed to load face detection models:", e);
    throw new Error("Face detection models failed to load");
  }
}

export async function detectFacesInFrame(
  video: HTMLVideoElement
): Promise<FaceRegion[]> {
  if (!faceapi || !modelsLoaded) {
    await loadFaceModels();
  }

  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.4,
  });

  const detections = await faceapi.detectAllFaces(video, options);

  return detections.map((d: any) => ({
    x: d.box.x / video.videoWidth,
    y: d.box.y / video.videoHeight,
    width: d.box.width / video.videoWidth,
    height: d.box.height / video.videoHeight,
    score: d.score,
  }));
}

export async function trackFaces(
  video: HTMLVideoElement,
  duration: number,
  onProgress?: (progress: number) => void
): Promise<FaceTrackingResult> {
  await loadFaceModels();

  const frames: FaceFrame[] = [];
  // Sample every 3 seconds, or every 5 seconds for long videos
  const sampleInterval = duration > 600 ? 5 : duration > 120 ? 3 : 2;
  const totalSamples = Math.ceil(duration / sampleInterval);
  let maxFaces = 0;
  let totalFaces = 0;

  const wasPlaying = !video.paused;
  if (wasPlaying) video.pause();

  const originalTime = video.currentTime;

  for (let i = 0; i < totalSamples; i++) {
    const time = i * sampleInterval;
    video.currentTime = time;

    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
    });

    // Small delay for frame to render
    await new Promise((r) => setTimeout(r, 50));

    try {
      const faces = await detectFacesInFrame(video);
      frames.push({ time, faces });
      maxFaces = Math.max(maxFaces, faces.length);
      totalFaces += faces.length;
    } catch {
      frames.push({ time, faces: [] });
    }

    onProgress?.(Math.round(((i + 1) / totalSamples) * 100));
  }

  // Restore video state
  video.currentTime = originalTime;
  if (wasPlaying) video.play();

  return {
    frames,
    maxFaces,
    averageFaces: totalSamples > 0 ? totalFaces / totalSamples : 0,
  };
}

export function getFacesAtTime(
  result: FaceTrackingResult,
  time: number
): FaceRegion[] {
  if (result.frames.length === 0) return [];

  // Find the two closest frames and interpolate
  let before = result.frames[0];
  let after = result.frames[result.frames.length - 1];

  for (let i = 0; i < result.frames.length; i++) {
    if (result.frames[i].time <= time) {
      before = result.frames[i];
      after = result.frames[Math.min(i + 1, result.frames.length - 1)];
    }
  }

  if (before.time === after.time || before.faces.length === 0) {
    return before.faces;
  }

  // Interpolate face positions
  const t =
    (time - before.time) / (after.time - before.time);

  const interpolated: FaceRegion[] = [];
  const count = Math.min(before.faces.length, after.faces.length);

  for (let i = 0; i < count; i++) {
    const bf = before.faces[i];
    const af = after.faces[i];
    interpolated.push({
      x: bf.x + (af.x - bf.x) * t,
      y: bf.y + (af.y - bf.y) * t,
      width: bf.width + (af.width - bf.width) * t,
      height: bf.height + (af.height - bf.height) * t,
      score: (bf.score + af.score) / 2,
    });
  }

  // Add any extra faces from the frame with more faces
  const longer = before.faces.length > after.faces.length ? before : after;
  for (let i = count; i < longer.faces.length; i++) {
    interpolated.push({ ...longer.faces[i] });
  }

  return interpolated;
}

export type LayoutType = "fill" | "fit" | "split" | "three" | "four";

export interface LayoutRegion {
  sx: number; sy: number; sw: number; sh: number; // source crop (normalized 0-1)
  dx: number; dy: number; dw: number; dh: number; // destination position (normalized 0-1)
}

export function calculateLayout(
  layoutType: LayoutType,
  faces: FaceRegion[],
  videoAspect: number
): LayoutRegion[] {
  switch (layoutType) {
    case "fill": {
      // Single speaker fills the frame
      if (faces.length === 0) {
        return [{ sx: 0.15, sy: 0, sw: 0.7, sh: 1, dx: 0, dy: 0, dw: 1, dh: 1 }];
      }
      const f = faces[0];
      const cx = f.x + f.width / 2;
      const cy = f.y + f.height / 2;
      const cropW = Math.min(0.5, f.width * 3);
      const cropH = cropW * (16 / 9);
      return [{
        sx: Math.max(0, Math.min(1 - cropW, cx - cropW / 2)),
        sy: Math.max(0, Math.min(1 - cropH, cy - cropH / 2)),
        sw: cropW,
        sh: Math.min(1, cropH),
        dx: 0, dy: 0, dw: 1, dh: 1,
      }];
    }

    case "fit":
      // Full frame letterboxed
      return [{ sx: 0, sy: 0, sw: 1, sh: 1, dx: 0, dy: 0.2, dw: 1, dh: 0.6 }];

    case "split": {
      // Two speakers stacked vertically
      if (faces.length < 2) {
        // Fallback: top half and bottom half of source
        return [
          { sx: 0, sy: 0, sw: 1, sh: 0.5, dx: 0, dy: 0, dw: 1, dh: 0.5 },
          { sx: 0, sy: 0.5, sw: 1, sh: 0.5, dx: 0, dy: 0.5, dw: 1, dh: 0.5 },
        ];
      }
      const sorted = [...faces].sort((a, b) => a.y - b.y);
      return sorted.slice(0, 2).map((f, i) => {
        const cx = f.x + f.width / 2;
        const cy = f.y + f.height / 2;
        const cropW = Math.min(0.6, f.width * 3);
        const cropH = cropW * (9 / 8);
        return {
          sx: Math.max(0, Math.min(1 - cropW, cx - cropW / 2)),
          sy: Math.max(0, Math.min(1 - cropH, cy - cropH / 2)),
          sw: cropW,
          sh: Math.min(1, cropH),
          dx: 0, dy: i * 0.5, dw: 1, dh: 0.5,
        };
      });
    }

    case "three": {
      // Main speaker top, two smaller bottom
      if (faces.length < 3) {
        return [
          { sx: 0.1, sy: 0, sw: 0.8, sh: 0.6, dx: 0, dy: 0, dw: 1, dh: 0.6 },
          { sx: 0, sy: 0.5, sw: 0.5, sh: 0.5, dx: 0, dy: 0.6, dw: 0.5, dh: 0.4 },
          { sx: 0.5, sy: 0.5, sw: 0.5, sh: 0.5, dx: 0.5, dy: 0.6, dw: 0.5, dh: 0.4 },
        ];
      }
      return faces.slice(0, 3).map((f, i) => {
        const cx = f.x + f.width / 2;
        const cy = f.y + f.height / 2;
        const cropW = i === 0 ? 0.5 : 0.4;
        const cropH = cropW;
        return {
          sx: Math.max(0, Math.min(1 - cropW, cx - cropW / 2)),
          sy: Math.max(0, Math.min(1 - cropH, cy - cropH / 2)),
          sw: cropW,
          sh: cropH,
          dx: i === 0 ? 0 : (i - 1) * 0.5,
          dy: i === 0 ? 0 : 0.6,
          dw: i === 0 ? 1 : 0.5,
          dh: i === 0 ? 0.6 : 0.4,
        };
      });
    }

    case "four": {
      // 2x2 grid
      const regions: LayoutRegion[] = [];
      for (let i = 0; i < 4; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        if (i < faces.length) {
          const f = faces[i];
          const cx = f.x + f.width / 2;
          const cy = f.y + f.height / 2;
          const cropW = 0.4;
          const cropH = 0.4;
          regions.push({
            sx: Math.max(0, Math.min(1 - cropW, cx - cropW / 2)),
            sy: Math.max(0, Math.min(1 - cropH, cy - cropH / 2)),
            sw: cropW, sh: cropH,
            dx: col * 0.5, dy: row * 0.5, dw: 0.5, dh: 0.5,
          });
        } else {
          regions.push({
            sx: col * 0.5, sy: row * 0.5, sw: 0.5, sh: 0.5,
            dx: col * 0.5, dy: row * 0.5, dw: 0.5, dh: 0.5,
          });
        }
      }
      return regions;
    }

    default:
      return [{ sx: 0, sy: 0, sw: 1, sh: 1, dx: 0, dy: 0, dw: 1, dh: 1 }];
  }
}
