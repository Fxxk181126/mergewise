import { anchor } from './anchor.js';
import { analyze } from './analyze.js';
import { buildLineMaps } from './diff.js';
import { fetchDiffFiles, createReview, createSummaryOnlyReview } from './github.js';
import { filterFindings } from './filter.js';
import { buildInlineComment, buildSummaryBody } from './publish.js';
import { prioritize } from './prioritize.js';
import {
  bumpPublishedCount,
  claimNextJob,
  getRepo,
  getRuleState,
  recordObservation,
  updateReviewStatus,
} from './db.js';
import type { ReviewMode } from './types.js';
import { MAX_FILES_PER_REVIEW } from './types.js';

export interface ClaimedJob {
  id: string;
  repo_id: bigint;
  pr_number: number;
  head_sha: string;
}

export interface WorkerDeps {
  claimNextJob: () => Promise<ClaimedJob | null>;
  getRepo: (repoId: bigint) => Promise<{
    installation_id: bigint;
    full_name: string;
    threshold: number;
    mode: ReviewMode;
  } | null>;
  getCurrentHeadSha: (installationId: bigint, owner: string, repo: string, pr: number) => Promise<string>;
  fetchDiffFiles: typeof fetchDiffFiles;
  analyze: typeof analyze;
  getRuleState: (repoId: bigint, rule: string) => Promise<string>;
  recordObservation: typeof recordObservation;
  bumpPublishedCount: typeof bumpPublishedCount;
  createReview: typeof createReview;
  createSummaryOnlyReview: typeof createSummaryOnlyReview;
  findPublishedReviewId: (
    installationId: bigint,
    owner: string,
    repo: string,
    pr: number,
    headSha: string,
  ) => Promise<bigint | null>;
  updateReviewStatus: typeof updateReviewStatus;
}

export type RunResult = 'idle' | 'done' | 'skipped' | 'failed';

export async function runOnce(deps: WorkerDeps): Promise<RunResult> {
  const job = await deps.claimNextJob();
  if (!job) return 'idle';

  try {
    const repo = await deps.getRepo(job.repo_id);
    if (!repo) {
      await deps.updateReviewStatus(job.id, 'skipped');
      return 'skipped';
    }

    const [owner, repoName] = repo.full_name.split('/');
    const currentHeadSha = await deps.getCurrentHeadSha(
      repo.installation_id,
      owner,
      repoName,
      job.pr_number,
    );
    if (currentHeadSha !== job.head_sha) {
      await deps.updateReviewStatus(job.id, 'skipped');
      return 'skipped';
    }

    const { files } = await deps.fetchDiffFiles(
      repo.installation_id,
      owner,
      repoName,
      job.pr_number,
    );
    const reviewFiles = prioritize(files).slice(0, MAX_FILES_PER_REVIEW);
    const lineMaps = buildLineMaps(reviewFiles);
    let findings: Awaited<ReturnType<typeof analyze>> = [];
    let analysisFailed = false;
    try {
      findings = await deps.analyze(reviewFiles);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'LLM analysis degraded to summary',
        reviewId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }));
      analysisFailed = true;
    }
    const anchored = anchor(findings, lineMaps);

    const ruleStates = new Map<string, string>();
    await Promise.all([...new Set(findings.map((f) => f.rule))].map(async (rule) => {
      ruleStates.set(rule, await deps.getRuleState(job.repo_id, rule));
    }));

    const filtered = filterFindings(anchored.valid, {
      mode: repo.mode,
      threshold: repo.threshold,
      mutes: new Set([...ruleStates].filter(([, state]) => state === 'muted').map(([rule]) => rule)),
    });

    const observations = [...filtered.observed, ...anchored.invalid];
    for (const observation of observations) {
      await deps.recordObservation(job.repo_id, job.pr_number, job.head_sha, observation);
    }

    if (repo.mode === 'shadow') {
      await deps.updateReviewStatus(job.id, 'done', findings);
      return 'done';
    }

    const publishedHeadSha = await deps.getCurrentHeadSha(
      repo.installation_id,
      owner,
      repoName,
      job.pr_number,
    );
    if (publishedHeadSha !== job.head_sha) {
      await deps.updateReviewStatus(job.id, 'skipped');
      return 'skipped';
    }

    const publishedReviewId = await deps.findPublishedReviewId(
      repo.installation_id,
      owner,
      repoName,
      job.pr_number,
      job.head_sha,
    );
    if (publishedReviewId !== null) {
      await deps.updateReviewStatus(job.id, 'done', findings, publishedReviewId);
      return 'done';
    }

    if (analysisFailed) {
      const reviewId = await deps.createSummaryOnlyReview(
        repo.installation_id,
        owner,
        repoName,
        job.pr_number,
        job.head_sha,
        '## MergeWise Review\n\n本轮结构化审查暂时失败，已按噪声预算降级：不发布猜测性行内评论。',
      );
      await deps.updateReviewStatus(job.id, 'done', findings, reviewId);
      return 'done';
    }

    const comments = filtered.inline.map((f) => ({
      path: f.file,
      line: f.endLine ?? f.line,
      side: 'RIGHT' as const,
      ...(f.endLine && f.endLine > f.line ? { start_line: f.line } : {}),
      body: buildInlineComment(f),
    }));

    let reviewId: bigint;
    try {
      reviewId = await deps.createReview(
        repo.installation_id,
        owner,
        repoName,
        job.pr_number,
        job.head_sha,
        buildSummaryBody(filtered.inline, filtered.summary, anchored.invalid),
        comments,
      );
    } catch (error) {
      if ((error as { status?: number }).status !== 422) throw error;

      reviewId = await deps.createSummaryOnlyReview(
        repo.installation_id,
        owner,
        repoName,
        job.pr_number,
        job.head_sha,
        buildSummaryBody([], filtered.summary, anchored.invalid),
      );
    }

    await deps.updateReviewStatus(job.id, 'done', findings, reviewId);

    for (const finding of [...filtered.inline, ...filtered.summary]) {
      try {
        await deps.bumpPublishedCount(job.repo_id, finding.rule);
      } catch (error) {
        console.error(JSON.stringify({
          level: 'error',
          msg: 'failed to update rule stats after publication',
          reviewId: job.id,
          postedReviewId: reviewId.toString(),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    return 'done';
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'review job failed',
      reviewId: job.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    await deps.updateReviewStatus(job.id, 'failed');
    return 'failed';
  }
}
