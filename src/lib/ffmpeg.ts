/* eslint-disable @typescript-eslint/no-explicit-any */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

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
      onProgress?.(
        pct,
        `Processing... ${pct}% (${Math.round((time || 0) / 1000000)}s)`
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

  const inputName = "input" + getExtension(videoFile.name);
  const outputName = "audio.wav";

  await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputName,
  ]);

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(inputName);
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

  const inputName = "input" + getExtension(videoFile.name);
  const outputName = `chunk_${startSec}.wav`;

  await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
  await ffmpeg.exec([
    "-i",
    inputName,
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

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(inputName);
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
  onProgress?.(0, "Trimming video...");

  const inputName = "input" + getExtension(videoFile.name);
  const outputName = "trimmed.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
  await ffmpeg.exec([
    "-i",
    inputName,
    "-ss",
    startTime.toString(),
    "-to",
    endTime.toString(),
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    outputName,
  ]);

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  onProgress?.(100, "Trim complete");
  // @ts-expect-error FFmpeg FileData Uint8Array is runtime-compatible with BlobPart
  return new Blob([data], { type: "video/mp4" });
}

export async function exportClip(
  videoFile: File,
  options: ExportOptions,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const ffmpeg = await loadFFmpeg(onProgress);
  onProgress?.(0, "Preparing export...");

  const inputName = "input" + getExtension(videoFile.name);
  const outputName = "output.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

  const args: string[] = [];

  // Input-seek: place -ss BEFORE -i for fast seeking (avoids decoding from start)
  if (options.trimStart !== undefined && options.trimStart > 0) {
    args.push("-ss", options.trimStart.toString());
  }
  args.push("-i", inputName);

  // -t is duration from seek point (not absolute end time) when using input-seek
  if (options.trimStart !== undefined && options.trimEnd !== undefined) {
    const duration = options.trimEnd - options.trimStart;
    if (duration > 0) args.push("-t", duration.toString());
  } else if (options.trimEnd !== undefined && (options.trimStart === undefined || options.trimStart === 0)) {
    args.push("-t", options.trimEnd.toString());
  }

  // Video filters
  const filters: string[] = [];

  // Aspect ratio conversion
  const resMap = {
    "720p": { "9:16": "720:1280", "1:1": "720:720", "16:9": "1280:720" },
    "1080p": {
      "9:16": "1080:1920",
      "1:1": "1080:1080",
      "16:9": "1920:1080",
    },
  };
  const resolution = resMap[options.quality][options.aspectRatio];
  filters.push(
    `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:black`
  );

  if (filters.length > 0) {
    args.push("-vf", filters.join(","));
  }

  // Subtitle burn-in
  if (options.captionFile) {
    await ffmpeg.writeFile("captions.ass", options.captionFile);
    const existingVf = args.indexOf("-vf");
    if (existingVf >= 0) {
      args[existingVf + 1] = args[existingVf + 1] + ",ass=captions.ass";
    } else {
      args.push("-vf", "ass=captions.ass");
    }
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-y",
    outputName
  );

  onProgress?.(10, "Encoding video...");
  await ffmpeg.exec(args);

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  onProgress?.(100, "Export complete!");
  // @ts-expect-error FFmpeg FileData Uint8Array is runtime-compatible with BlobPart
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
  videoFile: File,
  timeSeconds: number = 0
): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.currentTime = timeSeconds;

    video.onloadeddata = () => {
      video.currentTime = timeSeconds;
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0);
      URL.revokeObjectURL(video.src);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };

    video.onerror = () => {
      resolve("");
    };

    video.src = URL.createObjectURL(videoFile);
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
