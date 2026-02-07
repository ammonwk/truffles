import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface RenderConfig {
  speed?: number;
  skipInactive?: boolean;
  width?: number;
  height?: number;
}

interface RenderResult {
  outputPath: string;
  durationSec: number;
}

type ProgressCallback = (percent: number, message: string) => void;

const DEFAULT_CONFIG: RenderConfig = {
  speed: 2,
  skipInactive: true,
  width: 1280,
  height: 720,
};

const RENDER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function renderSessionVideo(
  sessionId: string,
  rrwebEvents: unknown[],
  config?: Partial<RenderConfig>,
  onProgress?: ProgressCallback,
): Promise<RenderResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const tempDir = path.join(os.tmpdir(), `truffles-render-${sessionId}`);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });

    const eventsPath = path.join(tempDir, 'events.json');
    const configPath = path.join(tempDir, 'config.json');
    const outputPath = path.join(tempDir, 'recording.mp4');

    await fs.promises.writeFile(eventsPath, JSON.stringify(rrwebEvents));
    await fs.promises.writeFile(configPath, JSON.stringify({
      speed: mergedConfig.speed,
      skipInactive: mergedConfig.skipInactive,
      resolutionWidth: mergedConfig.width,
      resolutionHeight: mergedConfig.height,
    }));

    onProgress?.(5, 'Starting rrvideo render');

    const durationSec = await new Promise<number>((resolve, reject) => {
      const child = spawn('rrvideo', [
        '--input', eventsPath,
        '--output', outputPath,
        '--config', configPath,
      ], { cwd: tempDir });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        // Parse progress from rrvideo output
        const progressMatch = text.match(/(\d+)%/);
        if (progressMatch) {
          const percent = parseInt(progressMatch[1], 10);
          onProgress?.(Math.min(90, 5 + Math.round(percent * 0.85)), `Rendering: ${percent}%`);
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
        reject(new Error(`rrvideo timed out after ${RENDER_TIMEOUT_MS / 1000}s`));
      }, RENDER_TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`rrvideo exited with code ${code}: ${stderr || stdout}`));
          return;
        }

        // Try to get duration from ffprobe
        const ffprobe = spawn('ffprobe', [
          '-v', 'quiet',
          '-show_entries', 'format=duration',
          '-of', 'csv=p=0',
          outputPath,
        ]);
        let durationOutput = '';
        ffprobe.stdout.on('data', (data: Buffer) => {
          durationOutput += data.toString();
        });
        ffprobe.on('close', () => {
          const parsed = parseFloat(durationOutput.trim());
          resolve(isNaN(parsed) ? 0 : Math.round(parsed));
        });
        ffprobe.on('error', () => {
          resolve(0);
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start rrvideo: ${err.message}`));
      });
    });

    onProgress?.(95, 'Render complete');

    return { outputPath, durationSec };
  } catch (error) {
    // Don't clean up here — caller handles cleanup after upload
    throw error;
  }
}

export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-ss', '00:00:02',
      '-i', videoPath,
      '-vframes', '1',
      '-y',
      outputPath,
    ]);

    let stderr = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg thumbnail failed with code ${code}: ${stderr}`));
        return;
      }
      resolve();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

export async function cleanupTempDir(sessionId: string): Promise<void> {
  const tempDir = path.join(os.tmpdir(), `truffles-render-${sessionId}`);
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch {
    console.warn(`Failed to clean up temp dir: ${tempDir}`);
  }
}
