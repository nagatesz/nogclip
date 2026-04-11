import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/transcription";
import { analyzeTranscript } from "@/lib/ai-analysis";
import ffmpeg from "fluent-ffmpeg";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";

const TEMP_DIR = path.join(os.tmpdir(), "nogclip-processing");

// Ensure temp directory exists
async function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true });
  }
}

// Extract audio from video using server-side FFmpeg
// For long videos, only extract first 10 minutes to avoid serverless timeout
async function extractAudioServer(videoPath: string, outputPath: string, duration: number): Promise<void> {
  const MAX_DURATION = 10 * 60; // 10 minutes max to avoid serverless timeout
  const extractionDuration = Math.min(duration, MAX_DURATION);
  
  return new Promise((resolve, reject) => {
    const command = ffmpeg(videoPath);
    
    if (duration > MAX_DURATION) {
      // Only extract first 10 minutes for long videos
      command.seekInput(0).outputOptions([
        "-t", extractionDuration.toString(),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1"
      ]);
    } else {
      // Extract full audio for short videos
      command.outputOptions([
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1"
      ]);
    }
    
    command
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("video") as File;
    const durationStr = formData.get("duration") as string;
    const duration = durationStr ? parseFloat(durationStr) : 0;
    
    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    // Create temp directory
    await ensureTempDir();

    // Save uploaded file to temp directory
    const videoPath = path.join(TEMP_DIR, `${Date.now()}-${file.name}`);
    const audioPath = path.join(TEMP_DIR, `${Date.now()}-audio.wav`);
    
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(videoPath, buffer);

    // Extract audio
    await extractAudioServer(videoPath, audioPath, duration);

    // Read audio file
    const audioBuffer = await readFile(audioPath);
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" });

    // Transcribe
    const transcription = await transcribeAudio(audioBlob);

    // Analyze
    const analysis = await analyzeTranscript(transcription.segments, transcription.words, duration);

    // Cleanup temp files
    await unlink(videoPath).catch(() => {});
    await unlink(audioPath).catch(() => {});

    return NextResponse.json({
      transcription,
      clips: analysis.clips,
      summary: analysis.summary
    });

  } catch (error) {
    console.error("Server-side processing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}

async function readFile(filePath: string): Promise<Buffer> {
  const fs = await import("fs/promises");
  return fs.readFile(filePath);
}
