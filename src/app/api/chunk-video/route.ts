import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const TEMP_DIR = path.join(process.env.TEMP || "/tmp", "nogclip-chunking");

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const chunkDuration = parseInt(formData.get("chunkDuration") as string) || 20 * 60; // 20 minutes default

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Create temp directory
    if (!existsSync(TEMP_DIR)) {
      await mkdir(TEMP_DIR, { recursive: true });
    }

    const videoId = Date.now().toString();
    const inputPath = path.join(TEMP_DIR, `${videoId}-input.mp4`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Get video duration
    const { stdout: durationOutput } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
    );
    const duration = parseFloat(durationOutput.trim());

    // Calculate number of chunks
    const numChunks = Math.ceil(duration / chunkDuration);

    const chunks: { id: string; name: string; start: number; end: number; duration: number }[] = [];

    // Create chunks using FFmpeg
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkDuration;
      const end = Math.min((i + 1) * chunkDuration, duration);
      const chunkDurationActual = end - start;
      const outputPath = path.join(TEMP_DIR, `${videoId}-part${i + 1}.mp4`);

      await execAsync(
        `ffmpeg -i "${inputPath}" -ss ${start} -t ${chunkDurationActual} -c copy "${outputPath}" -y`
      );

      chunks.push({
        id: `${videoId}-part${i + 1}`,
        name: `Part ${i + 1}`,
        start,
        end,
        duration: chunkDurationActual,
      });
    }

    // Clean up input file
    await execAsync(`rm "${inputPath}"`);

    return NextResponse.json({
      videoId,
      chunks,
      totalDuration: duration,
    });
  } catch (error: any) {
    console.error("Chunking error:", error);
    return NextResponse.json({ error: error.message || "Chunking failed" }, { status: 500 });
  }
}
