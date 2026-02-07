import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const execFileAsync = promisify(execFile);

interface ExtractedFrame {
  base64: string;
  mimeType: string;
  timestampSec: number;
}

export async function extractFrames(
  videoPath: string,
  intervalSec: number = 5,
  maxFrames: number = 20,
): Promise<ExtractedFrame[]> {
  const tmpDir = path.join(os.tmpdir(), `truffles-frames-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Get video duration
    const { stdout: probeOut } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ]);
    const durationSec = parseFloat(probeOut.trim()) || 60;

    // Calculate frame timestamps
    const frameCount = Math.min(maxFrames, Math.ceil(durationSec / intervalSec));
    const timestamps: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      timestamps.push(i * intervalSec);
    }

    // Extract frames using ffmpeg
    const outputPattern = path.join(tmpDir, 'frame-%04d.jpg');
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vf', `fps=1/${intervalSec}`,
      '-frames:v', String(frameCount),
      '-q:v', '3',
      outputPattern,
    ], { timeout: 60_000 });

    // Read extracted frames
    const frames: ExtractedFrame[] = [];
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.jpg')).sort();

    for (let i = 0; i < files.length && i < maxFrames; i++) {
      const filePath = path.join(tmpDir, files[i]);
      const buffer = fs.readFileSync(filePath);
      frames.push({
        base64: buffer.toString('base64'),
        mimeType: 'image/jpeg',
        timestampSec: timestamps[i] ?? i * intervalSec,
      });
    }

    return frames;
  } finally {
    // Cleanup temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function downloadVideoFromS3(videoUrl: string, destinationPath: string): Promise<void> {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destinationPath, buffer);
}
