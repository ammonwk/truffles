import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

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
  speed: 4,
  skipInactive: true,
  width: 1280,
  height: 720,
};

const RENDER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------- Browser singleton ----------

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  console.log('[rrvideo] Launching Playwright Chromium...');
  browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  browser.on('disconnected', () => {
    browser = null;
  });
  console.log('[rrvideo] Chromium launched');
  return browser;
}

export async function shutdownBrowser(): Promise<void> {
  if (browser) {
    console.log('[rrvideo] Closing Playwright browser...');
    await browser.close().catch(() => {});
    browser = null;
  }
}

// ---------- rrweb-player assets (cached) ----------

let cachedPlayerJs: string | null = null;
let cachedPlayerCss: string | null = null;

function loadPlayerAssets(): { js: string; css: string } {
  if (!cachedPlayerJs || !cachedPlayerCss) {
    const playerDir = path.dirname(require.resolve('rrweb-player/dist/style.css'));
    cachedPlayerJs = fs.readFileSync(path.join(playerDir, 'rrweb-player.umd.cjs'), 'utf-8');
    cachedPlayerCss = fs.readFileSync(path.join(playerDir, 'style.css'), 'utf-8');
    console.log('[rrvideo] Loaded rrweb-player assets from node_modules');
  }
  return { js: cachedPlayerJs, css: cachedPlayerCss };
}

// ---------- Timeline collapsing ----------

const INACTIVE_GAP_THRESHOLD_MS = 5000; // gaps > 5s are considered inactive
const COLLAPSED_GAP_MS = 1000; // replace inactive gaps with 1s

/**
 * Collapse long inactive gaps in the event timeline so the player doesn't
 * spend minutes fast-forwarding through hours of idle time.
 */
function collapseInactiveGaps(events: unknown[]): unknown[] {
  if (events.length < 2) return events;

  // Sort by timestamp and extract original timestamps
  const sorted = [...events].sort(
    (a, b) => ((a as any).timestamp as number) - ((b as any).timestamp as number),
  );
  const origTimestamps = sorted.map((e) => (e as any).timestamp as number);

  // Calculate cumulative shift: walk original timestamps, accumulate excess from large gaps
  let cumulativeShift = 0;
  const shifts = [0]; // shift for index 0 is always 0

  for (let i = 1; i < origTimestamps.length; i++) {
    const gap = origTimestamps[i] - origTimestamps[i - 1];
    if (gap > INACTIVE_GAP_THRESHOLD_MS) {
      cumulativeShift += gap - COLLAPSED_GAP_MS;
    }
    shifts.push(cumulativeShift);
  }

  if (cumulativeShift === 0) return sorted;

  // Clone events with adjusted timestamps
  const collapsed = sorted.map((e, i) => ({
    ...(e as Record<string, unknown>),
    timestamp: origTimestamps[i] - shifts[i],
  }));

  const originalSpan = origTimestamps[origTimestamps.length - 1] - origTimestamps[0];
  const collapsedSpan = (collapsed[collapsed.length - 1].timestamp as number) - (collapsed[0].timestamp as number);
  console.log(`[rrvideo] Collapsed timeline: ${Math.round(originalSpan / 1000)}s → ${Math.round(collapsedSpan / 1000)}s (removed ${Math.round(cumulativeShift / 1000)}s of idle time)`);

  return collapsed;
}

// ---------- HTML builder ----------

function buildReplayHtml(events: unknown[], config: Required<RenderConfig>): string {
  const { js, css } = loadPlayerAssets();

  // Escape </script> in event data to avoid breaking the HTML
  const eventsJson = JSON.stringify(events).replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; }
    body { width: ${config.width}px; height: ${config.height}px; overflow: hidden; background: #000; }
    .rr-player { width: ${config.width}px !important; height: ${config.height}px !important; }
    .replayer-wrapper { width: ${config.width}px !important; height: ${config.height}px !important; }
    ${css}
  </style>
</head>
<body>
  <div id="player"></div>
  <script>${js}</script>
  <script>
    window.__replayFinished = false;
    window.__replayError = null;

    // Suppress rrweb replayer mutation warnings — they are non-fatal and
    // produce massive binary-encoded log spam from PostHog's event format.
    var _origWarn = console.warn;
    console.warn = function() {
      var msg = arguments[0];
      if (typeof msg === 'string' && msg.indexOf('[replayer]') !== -1) return;
      _origWarn.apply(console, arguments);
    };

    try {
      var events = ${eventsJson};

      // UMD may export { default: Constructor } or Constructor directly
      var PlayerCtor = (typeof rrwebPlayer === 'function') ? rrwebPlayer
        : (rrwebPlayer && rrwebPlayer.default) ? rrwebPlayer.default
        : null;

      if (!PlayerCtor) {
        throw new Error('rrwebPlayer constructor not found. typeof rrwebPlayer=' + typeof rrwebPlayer +
          ', keys=' + (rrwebPlayer ? Object.keys(rrwebPlayer).join(',') : 'N/A'));
      }

      console.log('[replay] Using constructor:', PlayerCtor.name || 'anonymous');

      var player = new PlayerCtor({
        target: document.getElementById('player'),
        props: {
          events: events,
          showController: false,
          speed: ${config.speed},
          skipInactive: false,
          autoPlay: false,
          width: ${config.width},
          height: ${config.height},
        },
      });

      var replayer = player.getReplayer();
      var meta = replayer.getMetaData();
      var totalMs = meta.totalTime || (meta.endTime - meta.startTime) || 0;
      console.log('[replay] meta: totalTime=' + totalMs + 'ms, startTime=' + meta.startTime + ', endTime=' + meta.endTime);

      window.__replayMeta = { totalMs: totalMs, currentTime: 0, state: 'init' };

      replayer.on('finish', function() {
        console.log('[replay] finish event fired');
        window.__replayFinished = true;
        window.__replayMeta.state = 'finished';
      });

      // Track progress for external polling
      setInterval(function() {
        try {
          var ct = replayer.getCurrentTime();
          window.__replayMeta.currentTime = ct;
          window.__replayMeta.state = 'playing';
        } catch(e) {}
      }, 500);

      // Small delay to let the player fully initialize before playing
      setTimeout(function() {
        console.log('[replay] calling play()');
        player.play();
      }, 500);

    } catch (err) {
      console.error('[replay] init error:', err);
      window.__replayError = err.message || String(err);
    }
  </script>
</body>
</html>`;
}

// ---------- WebM → MP4 conversion ----------

function convertWebmToMp4(webmPath: string, mp4Path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i', webmPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-an',
      mp4Path,
    ]);

    let stderr = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg WebM→MP4 conversion failed with code ${code}: ${stderr}`));
        return;
      }

      // Get duration via ffprobe
      const probe = spawn('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        mp4Path,
      ]);
      let durationOutput = '';
      probe.stdout.on('data', (data: Buffer) => {
        durationOutput += data.toString();
      });
      probe.on('close', () => {
        const parsed = parseFloat(durationOutput.trim());
        resolve(isNaN(parsed) ? 0 : Math.round(parsed));
      });
      probe.on('error', () => {
        resolve(0);
      });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

// ---------- Main render function ----------

export async function renderSessionVideo(
  sessionId: string,
  rrwebEvents: unknown[],
  config?: Partial<RenderConfig>,
  onProgress?: ProgressCallback,
): Promise<RenderResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config } as Required<RenderConfig>;
  const tempDir = path.join(os.tmpdir(), `truffles-render-${sessionId}`);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Estimate actual active replay duration (skipInactive compresses idle gaps)
    const timestamps = rrwebEvents
      .filter((e: any) => typeof e?.timestamp === 'number')
      .map((e: any) => e.timestamp as number)
      .sort((a, b) => a - b);
    let activeDurationMs = 0;
    const INACTIVE_THRESHOLD_MS = 5000; // rrweb-player default skip threshold
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      // Count active gaps; inactive gaps are skipped near-instantly
      activeDurationMs += gap <= INACTIVE_THRESHOLD_MS ? gap : 500;
    }
    if (activeDurationMs === 0) activeDurationMs = 30000;
    const expectedReplayMs = activeDurationMs / mergedConfig.speed;

    onProgress?.(5, 'Launching Playwright browser');

    const b = await getBrowser();
    const videoDir = path.join(tempDir, 'video');
    await fs.promises.mkdir(videoDir, { recursive: true });

    onProgress?.(10, 'Creating browser context with video recording');

    const context = await b.newContext({
      viewport: { width: mergedConfig.width, height: mergedConfig.height },
      recordVideo: {
        dir: videoDir,
        size: { width: mergedConfig.width, height: mergedConfig.height },
      },
    });

    const page = await context.newPage();

    // Write replay HTML and navigate to it
    const htmlPath = path.join(tempDir, 'replay.html');
    const collapsedEvents = collapseInactiveGaps(rrwebEvents);
    await fs.promises.writeFile(htmlPath, buildReplayHtml(collapsedEvents, mergedConfig));

    // Forward browser console/errors to Node for debugging (filter noise)
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[replay]')) {
        console.log(`[rrvideo:browser] ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      console.error(`[rrvideo:browser] PAGE ERROR: ${err.message}`);
    });

    onProgress?.(15, 'Loading rrweb replay');
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });

    // Check for initialization errors
    const initError = await page.evaluate('window.__replayError');
    if (initError) {
      throw new Error(`rrweb-player init failed in browser: ${initError}`);
    }

    console.log(`[rrvideo] Replay started for ${sessionId} (expected ~${Math.round(expectedReplayMs / 1000)}s at ${mergedConfig.speed}x)`);

    // Active polling loop: track progress, detect stalls, enforce timeout
    const startTime = Date.now();
    const POLL_INTERVAL_MS = 2000;
    const STALL_LIMIT = 10; // give up after this many consecutive stalled polls
    const MAX_WALL_MS = Math.min(RENDER_TIMEOUT_MS, Math.max(120_000, expectedReplayMs * 3));
    let lastCurrentTime = -1;
    let stallCount = 0;

    while (true) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const meta = await page.evaluate('window.__replayMeta').catch(() => null) as {
        totalMs: number; currentTime: number; state: string;
      } | null;
      const finished = await page.evaluate('window.__replayFinished').catch(() => false);
      const elapsed = Date.now() - startTime;

      if (finished) {
        console.log(`[rrvideo] Replay finished for ${sessionId} in ${Math.round(elapsed / 1000)}s`);
        break;
      }

      if (meta) {
        const pct = meta.totalMs > 0 ? Math.round((meta.currentTime / meta.totalMs) * 100) : 0;
        console.log(`[rrvideo] Progress: ${pct}% (${Math.round(meta.currentTime / 1000)}s / ${Math.round(meta.totalMs / 1000)}s) state=${meta.state} wall=${Math.round(elapsed / 1000)}s`);
        onProgress?.(15 + Math.round(pct * 0.55), `Replaying: ${pct}%`);

        // Stall detection: if currentTime hasn't advanced, increment counter
        if (meta.currentTime === lastCurrentTime && meta.state === 'playing') {
          stallCount++;
        } else {
          stallCount = 0;
        }
        lastCurrentTime = meta.currentTime;
      }

      // Stall bailout: player is stuck, accept whatever video we have
      if (stallCount >= STALL_LIMIT) {
        console.warn(`[rrvideo] Replay stalled for ${sessionId} (${STALL_LIMIT} polls with no progress). Accepting partial video.`);
        break;
      }

      // Wall clock timeout
      if (elapsed > MAX_WALL_MS) {
        console.warn(`[rrvideo] Wall timeout (${Math.round(MAX_WALL_MS / 1000)}s) for ${sessionId}. Accepting partial video.`);
        break;
      }
    }

    onProgress?.(70, 'Finalizing video recording');

    // Close page and context to finalize the WebM
    const videoPath = await page.video()?.path();
    await page.close();
    await context.close();

    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error('Playwright did not produce a video file');
    }

    console.log(`[rrvideo] WebM saved: ${videoPath} (${Math.round(fs.statSync(videoPath).size / 1024)}KB)`);

    // Convert WebM → MP4
    onProgress?.(80, 'Converting WebM to MP4');
    const outputPath = path.join(tempDir, 'recording.mp4');
    const durationSec = await convertWebmToMp4(videoPath, outputPath);

    console.log(`[rrvideo] MP4 ready: ${outputPath} (duration: ${durationSec}s)`);
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
