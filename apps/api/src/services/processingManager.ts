import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Session } from '@truffles/db';
import type { ProcessSessionsResponse, WsMessage, WsProcessingProgress } from '@truffles/shared';
import {
  getSessionSnapshots,
  getSessionMetadata,
  extractConsoleErrors,
  extractNetworkFailures,
} from './posthog.js';
import {
  renderSessionVideo,
  generateThumbnail,
  cleanupTempDir,
} from './rrvideo.js';
import {
  uploadFile,
  getPresignedUrl,
  getS3Key,
} from './s3.js';

type BroadcastFn = (message: WsMessage) => void;

interface ActiveJob {
  sessionId: string;
  startedAt: Date;
}

export class ProcessingManager {
  private queue: string[] = [];
  private activeJobs = new Map<string, ActiveJob>();
  private cancelledSessions = new Set<string>();
  private maxConcurrent = 20;
  private broadcast: BroadcastFn;
  private onSessionComplete?: (posthogSessionId: string) => void;

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
  }

  setOnSessionComplete(callback: (posthogSessionId: string) => void): void {
    this.onSessionComplete = callback;
  }

  async enqueue(sessionIds: string[]): Promise<ProcessSessionsResponse> {
    const queued: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ sessionId: string; reason: string }> = [];

    for (const sessionId of sessionIds) {
      try {
        // Check if already being processed or completed
        const existing = await Session.findOne({ posthogSessionId: sessionId }).lean();
        if (existing) {
          if (existing.status === 'complete' || existing.status === 'rendering') {
            skipped.push(sessionId);
            continue;
          }
          // If pending or error, allow re-processing
          await Session.updateOne(
            { posthogSessionId: sessionId },
            { status: 'pending', errorMessage: null },
          );
        } else {
          // Create new session doc
          await Session.create({
            posthogSessionId: sessionId,
            startTime: new Date(),
            status: 'pending',
          });
        }

        // Check if already in queue or active
        if (this.activeJobs.has(sessionId) || this.queue.includes(sessionId)) {
          skipped.push(sessionId);
          continue;
        }

        this.queue.push(sessionId);
        queued.push(sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ sessionId, reason: message });
      }
    }

    // Start processing
    this.processNext();

    return { queued, skipped, errors };
  }

  private processNext(): void {
    while (this.activeJobs.size < this.maxConcurrent && this.queue.length > 0) {
      const sessionId = this.queue.shift()!;
      this.activeJobs.set(sessionId, {
        sessionId,
        startedAt: new Date(),
      });
      this.processSession(sessionId).catch((err) => {
        console.error(`Unexpected error processing ${sessionId}:`, err);
      });
    }
  }

  private checkCancelled(sessionId: string): void {
    if (this.cancelledSessions.has(sessionId)) {
      throw new Error('Cancelled by user');
    }
  }

  private async processSession(sessionId: string): Promise<void> {
    try {
      this.checkCancelled(sessionId);

      // Broadcast started
      this.broadcast({
        type: 'processing:started',
        sessionId,
        data: { phase: 'downloading', percent: 0, message: 'Starting' },
      });

      await Session.updateOne(
        { posthogSessionId: sessionId },
        { status: 'rendering' },
      );

      // Phase 1: Download rrweb events
      this.broadcastProgress(sessionId, 'downloading', 10, 'Downloading session recordings');
      this.checkCancelled(sessionId);
      const rrwebEvents = await getSessionSnapshots(sessionId);
      console.log(`[processing] ${sessionId}: downloaded ${rrwebEvents.length} rrweb events`);
      this.broadcastProgress(sessionId, 'downloading', 20, `Downloaded ${rrwebEvents.length} events`);

      // Fetch metadata
      const meta = await getSessionMetadata(sessionId);

      // Extract console errors and network failures from rrweb events
      const consoleErrors = extractConsoleErrors(rrwebEvents);
      const networkFailures = extractNetworkFailures(rrwebEvents);
      console.log(
        `[processing] ${sessionId}: extracted ${consoleErrors.length} console errors, ${networkFailures.length} network failures`,
      );

      // Update session with metadata
      const firstTimestamp = rrwebEvents[0]?.timestamp ?? Date.now();
      const lastTimestamp = rrwebEvents[rrwebEvents.length - 1]?.timestamp ?? firstTimestamp;
      const durationSec = Math.round((lastTimestamp - firstTimestamp) / 1000);

      await Session.updateOne(
        { posthogSessionId: sessionId },
        {
          userEmail: meta.userEmail,
          userId: meta.userId,
          startTime: new Date(firstTimestamp),
          duration: durationSec,
          metadata: meta.metadata,
          consoleErrors,
          networkFailures,
        },
      );

      // Phase 2: Render video via rrvideo
      this.checkCancelled(sessionId);
      this.broadcastProgress(sessionId, 'rendering', 25, 'Starting video render');
      const { outputPath: videoPath, durationSec: videoDuration } = await renderSessionVideo(
        sessionId,
        rrwebEvents,
        undefined,
        (percent, message) => {
          this.broadcastProgress(sessionId, 'rendering', 25 + Math.round(percent * 0.5), message);
        },
      );

      // Generate thumbnail
      const thumbnailPath = path.join(
        path.dirname(videoPath),
        'thumbnail.jpg',
      );
      try {
        await generateThumbnail(videoPath, thumbnailPath);
      } catch (err) {
        console.warn(`Thumbnail generation failed for ${sessionId}:`, err);
      }

      // Phase 3: Upload to S3
      this.checkCancelled(sessionId);
      this.broadcastProgress(sessionId, 'uploading', 80, 'Uploading video to S3');

      const videoKey = getS3Key(sessionId, 'recording.mp4');
      await uploadFile(videoKey, videoPath, 'video/mp4');

      let thumbnailKey: string | null = null;
      try {
        if (fs.existsSync(thumbnailPath)) {
          thumbnailKey = getS3Key(sessionId, 'thumbnail.jpg');
          await uploadFile(thumbnailKey, thumbnailPath, 'image/jpeg');
        }
      } catch {
        console.warn(`Thumbnail upload failed for ${sessionId}`);
      }

      // Upload rrweb events JSON for reference
      const eventsJsonPath = path.join(os.tmpdir(), `truffles-render-${sessionId}`, 'events.json');
      if (fs.existsSync(eventsJsonPath)) {
        const eventsKey = getS3Key(sessionId, 'rrweb-events.json');
        await uploadFile(eventsKey, eventsJsonPath, 'application/json');
      }

      this.broadcastProgress(sessionId, 'uploading', 95, 'Finalizing');
      this.checkCancelled(sessionId);

      // Update session doc
      await Session.updateOne(
        { posthogSessionId: sessionId },
        {
          status: 'complete',
          videoUrl: videoKey,
          thumbnailUrl: thumbnailKey,
          duration: videoDuration || durationSec,
        },
      );

      // Generate presigned URLs for the broadcast
      const videoPresigned = await getPresignedUrl(videoKey);
      const thumbnailPresigned = thumbnailKey ? await getPresignedUrl(thumbnailKey) : null;

      this.broadcast({
        type: 'processing:complete',
        sessionId,
        data: {
          videoUrl: videoPresigned,
          thumbnailUrl: thumbnailPresigned,
        },
      });

      // Trigger analysis pipeline
      if (this.onSessionComplete) {
        this.onSessionComplete(sessionId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Processing failed for ${sessionId}:`, message);

      await Session.updateOne(
        { posthogSessionId: sessionId },
        { status: 'error', errorMessage: message },
      ).catch(() => {});

      this.broadcast({
        type: 'processing:error',
        sessionId,
        data: { error: message },
      });
    } finally {
      this.activeJobs.delete(sessionId);
      this.cancelledSessions.delete(sessionId);
      await cleanupTempDir(sessionId);
      this.processNext();
    }
  }

  private broadcastProgress(
    sessionId: string,
    phase: WsProcessingProgress['phase'],
    percent: number,
    message: string,
  ): void {
    this.broadcast({
      type: 'processing:progress',
      sessionId,
      data: { phase, percent, message },
    });
  }

  async recoverStuckSessions(): Promise<void> {
    const stuck = await Session.find({
      status: { $in: ['rendering', 'pending'] },
    }).lean();

    if (stuck.length > 0) {
      console.log(`[ProcessingManager] Recovering ${stuck.length} stuck sessions`);
      const sessionIds = stuck.map((s) => s.posthogSessionId);
      // Reset to pending state
      await Session.updateMany(
        { posthogSessionId: { $in: sessionIds } },
        { status: 'pending', errorMessage: null },
      );
      for (const id of sessionIds) {
        if (!this.queue.includes(id) && !this.activeJobs.has(id)) {
          this.queue.push(id);
        }
      }
      this.processNext();
    }
  }

  getActiveJobs(): ActiveJob[] {
    return Array.from(this.activeJobs.values());
  }

  async reprocess(sessionId: string): Promise<void> {
    // Skip if already in-flight
    if (this.activeJobs.has(sessionId) || this.queue.includes(sessionId)) {
      throw new Error('Session is already being processed');
    }

    // Reset status regardless of current state
    await Session.updateOne(
      { posthogSessionId: sessionId },
      { status: 'pending', errorMessage: null, videoUrl: null, thumbnailUrl: null },
    );

    this.queue.push(sessionId);
    this.processNext();
  }

  async cancel(sessionId: string): Promise<void> {
    // Remove from queue if still pending
    const queueIdx = this.queue.indexOf(sessionId);
    if (queueIdx !== -1) {
      this.queue.splice(queueIdx, 1);
      await Session.updateOne(
        { posthogSessionId: sessionId },
        { status: 'error', errorMessage: 'Cancelled by user' },
      );
      this.broadcast({
        type: 'processing:error',
        sessionId,
        data: { error: 'Cancelled by user' },
      });
      return;
    }

    // Mark active job as cancelled so it bails out at the next checkpoint
    if (this.activeJobs.has(sessionId)) {
      this.cancelledSessions.add(sessionId);
      await Session.updateOne(
        { posthogSessionId: sessionId },
        { status: 'error', errorMessage: 'Cancelled by user' },
      );
      this.broadcast({
        type: 'processing:error',
        sessionId,
        data: { error: 'Cancelled by user' },
      });
      return;
    }

    throw new Error('Session is not currently processing');
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
