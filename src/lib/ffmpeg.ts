/* eslint-disable @typescript-eslint/no-explicit-any */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

// Web Audio API extraction for long videos to avoid FFmpeg memory issues
export async function extractAudioWithWebAudio(
  videoFile: File,
  onProgress?: ProgressCallback,
  startTime: number = 0,
  duration: number = 15 * 60
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.src = URL.createObjectURL(videoFile);
    video.muted = true;
    video.crossOrigin = "anonymous";

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    source.connect(audioContext.destination);

    const mediaRecorder = new MediaRecorder(destination.stream, {
      mimeType: "audio/webm"
    });

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(chunks, { type: "audio/webm" });
      URL.revokeObjectURL(video.src);
      resolve(audioBlob);
    };

    video.onloadedmetadata = () => {
      onProgress?.(0, "Starting audio extraction...");
      const endTime = startTime + duration;
      video.currentTime = startTime;
      mediaRecorder.start();
      video.play();

      const updateProgress = () => {
        const progress = ((video.currentTime - startTime) / duration) * 100;
        onProgress?.(progress, `Extracting audio... ${Math.round(video.currentTime - startTime)}s / ${Math.round(duration)}s`);
        
        if (video.currentTime >= endTime || video.ended) {
          mediaRecorder.stop();
          video.pause();
        } else {
          requestAnimationFrame(updateProgress);
        }
      };
      updateProgress();
    };

    video.onerror = (e) => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Video load error"));
    };

    video.load();
  });
}

export interface TrimOptions {
  startTime: number;
  endTime: number;
}

export interface ExportOptions {
  aspectRatio: "9:16" | "1:1" | "16:9";
  quality: "720p" | "1080p";
  captionFile?: string;
  trimStart?: number;
  trimEnd?: number;
}

export type ProgressCallback = (progress: number, message: string) => void;

export async function loadFFmpeg(
  onProgress?: ProgressCallback
): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onProgress?.(0, "Loading FFmpeg...");
    const ffmpeg = new FFmpeg();

    ffmpeg.on("progress", ({ progress, time }) => {
      const pct = Math.round(progress * 100);
      const timeMs = time || 0;
      const timeSec = timeMs / 1000000;
      onProgress?.(
        pct,
        `Processing... ${pct}% (${Math.round(timeSec)}s processed)`
      );
    });

    ffmpeg.on("log", ({ message }) => {
      console.log("[FFmpeg]", message);
    });

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript"
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm"
        ),
      });
    } catch {
      const stBaseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${stBaseURL}/ffmpeg-core.js`,
          "text/javascript"
        ),
        wasmURL: await toBlobURL(
          `${stBaseURL}/ffmpeg-core.wasm`,
          "application/wasm"
        ),
      });
    }

    onProgress?.(100, "FFmpeg ready");
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadPromise;
}

export async function extractAudio(
  videoFile: File,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg(onProgress);
  onProgress?.(0, "Extracting audio...");

  const outputName = "audio.wav";
  
  try { await ffmpeg.createDir("/worker"); } catch {}
  try { await ffmpeg.unmount("/worker"); } catch {}
  
  await ffmpeg.mount("WORKERFS" as any, { blobs: [{ name: "input.mp4", data: videoFile }] }, "/worker");

  try {
    await ffmpeg.exec([
      "-i",
      "/worker/input.mp4",
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      outputName,
    ]);
  } catch (e: any) {
    if (!e?.message?.includes("Aborted") && e !== "Aborted") throw e;
    console.warn("FFmpeg Aborted() logic caught, checking if output succeeded.");
  } finally {
    try { await ffmpeg.unmount("/worker"); } catch {}
  }

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(outputName);

  onProgress?.(100, "Audio extracted");
  // @ts-expect-error FFmpeg FileData Uint8Array is runtime-compatible with BlobPart
  return new Blob([data], { type: "audio/wav" });
}

export async function extractAudioChunk(
  videoFile: File,
  startSec: number,
  durationSec: number,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg(onProgress);

  const outputName = `chunk_${startSec}.wav`;

  try { await ffmpeg.createDir("/worker"); } catch {}
  try { await ffmpeg.unmount("/worker"); } catch {}
  
  await ffmpeg.mount("WORKERFS" as any, { blobs: [{ name: "input.mp4", data: videoFile }] }, "/worker");

  try {
    await ffmpeg.exec([
      "-i",
      "/worker/input.mp4",
      "-ss",
      startSec.toString(),
      "-t",
      durationSec.toString(),
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      outputName,
    ]);
  } catch (e: any) {
    if (!e?.message?.includes("Aborted") && e !== "Aborted") throw e;
  } finally {
    try { await ffmpeg.unmount("/worker"); } catch {}
  }

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(outputName);

  // @ts-expect-error FFmpeg FileData Uint8Array is runtime-compatible with BlobPart
  return new Blob([data], { type: "audio/wav" });
}

export async function trimVideo(
  videoFile: File,
  startTime: number,
  endTime: number,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg(onProgress);

  const outputName = "output.mp4";

  try { await ffmpeg.createDir("/worker"); } catch {}
  try { await ffmpeg.unmount("/worker"); } catch {}
  
  await ffmpeg.mount("WORKERFS" as any, { blobs: [{ name: "input.mp4", data: videoFile }] }, "/worker");

  onProgress?.(0, "Trimming video...");

  try {
    await ffmpeg.exec([
      "-v",
      "error",
      "-i",
      "/worker/input.mp4",
      "-ss",
      startTime.toString(),
      "-to",
      endTime.toString(),
      "-c:v",
      "copy", // Copy video stream instead of re-encoding where possible
      "-c:a",
      "copy", // Copy audio stream
      "-avoid_negative_ts",
      "make_zero",
      outputName,
    ]);
  } catch (e: any) {
    if (!e?.message?.includes("Aborted") && e !== "Aborted") throw e;
  } finally {
    try { await ffmpeg.unmount("/worker"); } catch {}
  }

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(outputName);

  onProgress?.(100, "Done");
  // @ts-expect-error Types
  return new Blob([data], { type: "video/mp4" });
}

export async function exportClip(
  videoFile: File,
  opts: ExportOptions,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg(onProgress);
  onProgress?.(0, "Initializing export...");

  const outputName = "output.mp4";

  try { await ffmpeg.createDir("/worker"); } catch {}
  try { await ffmpeg.unmount("/worker"); } catch {}
  
  await ffmpeg.mount("WORKERFS" as any, { blobs: [{ name: "input.mp4", data: videoFile }] }, "/worker");

  // Subtitle burn-in
  if (opts.captionFile) {
    await ffmpeg.writeFile("captions.ass", opts.captionFile);
  }

  const args: string[] = [];

  // Input-seek: place -ss BEFORE -i for fast seeking
  if (opts.trimStart !== undefined && opts.trimStart > 0) {
    args.push("-ss", opts.trimStart.toString());
  }
  args.push("-i", "/worker/input.mp4");

  if (opts.trimStart !== undefined && opts.trimEnd !== undefined) {
    const duration = opts.trimEnd - opts.trimStart;
    if (duration > 0) args.push("-t", duration.toString());
  } else if (opts.trimEnd !== undefined && (opts.trimStart === undefined || opts.trimStart === 0)) {
    args.push("-t", opts.trimEnd.toString());
  }

  // Video filters
  const filters: string[] = [];
  const resMap = {
    "720p": { "9:16": "720:1280", "1:1": "720:720", "16:9": "1280:720" },
    "1080p": { "9:16": "1080:1920", "1:1": "1080:1080", "16:9": "1920:1080" },
  };
  const resolution = resMap[opts.quality][opts.aspectRatio];
  filters.push(`scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:black`);

  if (opts.captionFile) {
    filters.push("ass=captions.ass");
  }

  if (filters.length > 0) {
    args.push("-vf", filters.join(","));
  }

  args.push(
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y", outputName
  );

  onProgress?.(10, "Encoding video...");

  try {
    await ffmpeg.exec(args);
  } catch (e: any) {
    if (!e?.message?.includes("Aborted") && e !== "Aborted") throw e;
  } finally {
    try { await ffmpeg.unmount("/worker"); } catch {}
  }

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(outputName);

  if (opts.captionFile) try { await ffmpeg.deleteFile("captions.ass"); } catch {}

  onProgress?.(100, "Export complete!");
  // @ts-expect-error Types
  return new Blob([data], { type: "video/mp4" });
}

export async function getVideoInfo(
  videoFile: File
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onerror = () => {
      resolve({ duration: 0, width: 0, height: 0 });
    };
    video.src = URL.createObjectURL(videoFile);
  });
}

export async function generateThumbnail(
  videoSource: File | string,
  timeSeconds: number = 0
): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    
    // Check if it's a file or a string URL
    const isFile = typeof videoSource !== "string";
    video.src = isFile ? URL.createObjectURL(videoSource) : videoSource;

    video.onloadeddata = () => {
      video.currentTime = timeSeconds;
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0);
      if (isFile) URL.revokeObjectURL(video.src);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };

    video.onerror = () => {
      if (isFile) URL.revokeObjectURL(video.src);
      resolve("");
    };
  });
}

export async function detectSilence(
  videoFile: File,
  thresholdDb: number = -30,
  minDuration: number = 0.5,
  onProgress?: ProgressCallback
): Promise<Array<{ start: number; end: number }>> {
  const ffmpeg = await loadFFmpeg(onProgress);
  onProgress?.(0, "Detecting silence...");

  const inputName = "input" + getExtension(videoFile.name);
  await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

  const logs: string[] = [];
  const logHandler = ({ message }: { message: string }) => {
    logs.push(message);
  };
  ffmpeg.on("log", logHandler);

  await ffmpeg.exec([
    "-i",
    inputName,
    "-af",
    `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
    "-f",
    "null",
    "-",
  ]);

  ffmpeg.off("log", logHandler);
  await ffmpeg.deleteFile(inputName);

  const silenceRegions: Array<{ start: number; end: number }> = [];
  let currentStart: number | null = null;

  for (const log of logs) {
    const startMatch = log.match(/silence_start:\s*([\d.]+)/);
    const endMatch = log.match(
      /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/
    );

    if (startMatch) {
      currentStart = parseFloat(startMatch[1]);
    }
    if (endMatch && currentStart !== null) {
      silenceRegions.push({
        start: currentStart,
        end: parseFloat(endMatch[1]),
      });
      currentStart = null;
    }
  }

  onProgress?.(100, `Found ${silenceRegions.length} silent regions`);
  return silenceRegions;
}

function getExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return ".mp4";
  return "." + ext;
}

export async function concatVideos(
  blobs: Blob[],
  onProgress?: ProgressCallback
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg(onProgress);
  onProgress?.(0, "Joining clips...");

  let concatList = "";
  for (let i = 0; i < blobs.length; i++) {
    const name = `part${i}.mp4`;
    await ffmpeg.writeFile(name, await fetchFile(blobs[i] as any));
    concatList += `file '${name}'\n`;
  }

  await ffmpeg.writeFile("concat.txt", concatList);
  await ffmpeg.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat.txt",
    "-c",
    "copy",
    "joined.mp4",
  ]);

  const data = (await ffmpeg.readFile("joined.mp4")) as Uint8Array;

  for (let i = 0; i < blobs.length; i++) {
    await ffmpeg.deleteFile(`part${i}.mp4`);
  }
  await ffmpeg.deleteFile("concat.txt");
  await ffmpeg.deleteFile("joined.mp4");

  onProgress?.(100, "Join complete");
  // @ts-expect-error FFmpeg FileData Uint8Array is runtime-compatible with BlobPart
  return new Blob([data], { type: "video/mp4" });
}
