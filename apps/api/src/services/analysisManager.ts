import { Session, Issue, Settings } from '@truffles/db';
import type { DetectedIssue } from '@truffles/shared';
import { analyzeSessionVideo } from './videoAnalysis.js';
import { analyzeSessionData } from './sessionDataAnalysis.js';
import { screenIssues } from './screeningService.js';
import { mergeAnalysisResults } from '../prompts/mergeResults.js';
import type { ExistingIssue } from '../prompts/mergeResults.js';
import type { AgentManager } from './agentManager.js';

export class AnalysisManager {
  private agentManager: AgentManager | null = null;

  setAgentManager(agentManager: AgentManager): void {
    this.agentManager = agentManager;
  }

  async analyzeSession(posthogSessionId: string): Promise<void> {
    console.log(`[analysis] starting analysis for session ${posthogSessionId}`);

    const session = await Session.findOne({ posthogSessionId }).lean();
    if (!session) {
      console.error(`[analysis] session not found: ${posthogSessionId}`);
      return;
    }

    // Update status to analyzing
    await Session.updateOne(
      { posthogSessionId },
      { status: 'analyzing' },
    );

    try {
      // Get settings for model selection
      const settings = await Settings.getOrCreate();

      const videoS3Key = session.videoUrl;
      const durationSec = session.duration ?? 60;
      const consoleErrors = session.consoleErrors ?? [];
      const networkFailures = session.networkFailures ?? [];
      const metadata = (session.metadata as Record<string, unknown>) ?? {};

      // Run video analysis + session data analysis in parallel
      const [videoResult, dataResult] = await Promise.all([
        videoS3Key
          ? analyzeSessionVideo(videoS3Key, durationSec, {
              primary: settings.videoModelPrimary,
              secondary: settings.videoModelSecondary,
            })
          : Promise.resolve({ primary: { issues: [] as DetectedIssue[], model: '', durationMs: 0 }, secondary: { issues: [] as DetectedIssue[], model: '', durationMs: 0 } }),
        analyzeSessionData(
          consoleErrors,
          networkFailures,
          metadata,
          settings.screeningModel,
        ),
      ]);

      console.log(
        `[analysis] video analysis found ${videoResult.primary.issues.length} (primary) + ${videoResult.secondary.issues.length} (secondary) issues, ` +
        `data analysis found ${dataResult.issues.length} issues`,
      );

      // Tag issues with source
      const videoIssues = [
        ...videoResult.primary.issues.map((i) => ({ ...i, source: videoResult.primary.model })),
        ...videoResult.secondary.issues.map((i) => ({ ...i, source: videoResult.secondary.model })),
      ];
      const dataIssues = dataResult.issues.map((i) => ({ ...i, source: dataResult.model }));

      // Fetch existing issues from the DB for dedup comparison
      // Include: issues from same session, plus recent issues (last 7 days) across all sessions
      const existingDbIssues = await Issue.find({
        $or: [
          { posthogSessionId },
          { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      })
        .select('_id title description status severity')
        .lean();

      const existingIssues: ExistingIssue[] = existingDbIssues.map((doc) => ({
        id: doc._id.toString(),
        title: doc.title,
        description: doc.description,
        status: doc.status as ExistingIssue['status'],
        severity: doc.severity,
      }));

      console.log(`[analysis] found ${existingIssues.length} existing issues for dedup comparison`);

      // Merge, deduplicate (LLM-based), then screen
      const mergeResult = await mergeAnalysisResults(videoIssues, dataIssues, existingIssues);
      console.log(
        `[analysis] dedup: ${mergeResult.unique.length} unique, ${mergeResult.dropped.length} dropped as duplicates (${mergeResult.durationMs}ms, model=${mergeResult.model})`,
      );

      if (mergeResult.unique.length === 0) {
        await Session.updateOne(
          { posthogSessionId },
          { status: 'complete', issueCount: 0 },
        );
        console.log(`[analysis] no unique issues after dedup for session ${posthogSessionId}`);
        return;
      }

      // Screen the unique (non-duplicate) issues
      const screeningResult = await screenIssues(
        mergeResult.unique.map(({ source: _source, ...rest }) => rest),
        settings.screeningModel,
      );
      console.log(
        `[analysis] screening: ${screeningResult.kept.length} kept, ${screeningResult.dropped.length} dropped`,
      );

      // Save Issue documents for kept issues
      const sessionId = session._id;
      const issuePromises = screeningResult.kept.map(async (keptIssue) => {
        const matchedMerged = mergeResult.unique.find((m) => m.title === keptIssue.title);
        return Issue.create({
          sessionId,
          posthogSessionId,
          severity: keptIssue.severity,
          title: keptIssue.title,
          description: keptIssue.description,
          timestampSec: keptIssue.timestampSec,
          status: 'queued',
          foundAt: new Date(),
          llmReasoning: keptIssue.reasoning,
          screeningReasoning: keptIssue.screeningReasoning,
          detectedBy: matchedMerged?.source ?? 'unknown',
          screenedBy: screeningResult.model,
        });
      });

      // Also save dropped issues as false_alarm for reference
      const droppedPromises = screeningResult.dropped.map(async (droppedIssue) => {
        const matchedMerged = mergeResult.unique.find((m) => m.title === droppedIssue.title);
        return Issue.create({
          sessionId,
          posthogSessionId,
          severity: droppedIssue.severity,
          title: droppedIssue.title,
          description: droppedIssue.description,
          timestampSec: droppedIssue.timestampSec,
          status: 'false_alarm',
          foundAt: new Date(),
          llmReasoning: droppedIssue.reasoning,
          screeningReasoning: droppedIssue.screeningReasoning,
          falseAlarmReason: droppedIssue.dropReason,
          detectedBy: matchedMerged?.source ?? 'unknown',
          screenedBy: screeningResult.model,
        });
      });

      const [keptIssues] = await Promise.all([
        Promise.all(issuePromises),
        Promise.all(droppedPromises),
      ]);

      // Update session issue count
      await Session.updateOne(
        { posthogSessionId },
        {
          status: 'complete',
          issueCount: keptIssues.length,
        },
      );

      console.log(
        `[analysis] saved ${keptIssues.length} issues (${screeningResult.dropped.length} dropped) for session ${posthogSessionId}`,
      );

      // Auto-queue agents for kept issues
      if (this.agentManager && keptIssues.length > 0) {
        for (const issueDocs of keptIssues) {
          try {
            await this.agentManager.startAgent({
              issueId: issueDocs._id.toString(),
              issueTitle: issueDocs.title,
              issueDescription: issueDocs.description,
              severity: issueDocs.severity as 'red' | 'yellow',
              sessionContext: {
                consoleErrors: consoleErrors.slice(0, 10),
                networkFailures: networkFailures.slice(0, 10),
                userEmail: session.userEmail ?? undefined,
              },
            });
            console.log(`[analysis] queued agent for issue ${issueDocs._id}`);
          } catch (err) {
            console.error(`[analysis] failed to queue agent for issue ${issueDocs._id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error(`[analysis] failed for session ${posthogSessionId}:`, err);
      await Session.updateOne(
        { posthogSessionId },
        { status: 'error', errorMessage: `Analysis failed: ${err instanceof Error ? err.message : String(err)}` },
      );
    }
  }
}
