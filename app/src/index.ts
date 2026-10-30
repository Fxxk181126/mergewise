import { serve } from '@hono/node-server';
import { env } from './env.js';
import {
  bumpPublishedCount,
  claimNextJob,
  closePool,
  ensureReposTable,
  getRepo,
  getRuleState,
  recordObservation,
  updateReviewStatus,
} from './db.js';
import {
  createReview,
  createSummaryOnlyReview,
  fetchDiffFiles,
  findPublishedReviewId,
  getPullRequestHeadSha,
} from './github.js';
import { analyze } from './analyze.js';
import webhookApp from './webhook.js';
import { runOnce, type WorkerDeps } from './worker.js';

const workerDeps: WorkerDeps = {
  claimNextJob,
  getRepo,
  getCurrentHeadSha: getPullRequestHeadSha,
  fetchDiffFiles,
  analyze,
  getRuleState,
  recordObservation,
  bumpPublishedCount,
  createReview,
  createSummaryOnlyReview,
  findPublishedReviewId,
  updateReviewStatus,
};

let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startWorker(): Promise<void> {
  while (!stopping) {
    const result = await runOnce(workerDeps);
    if (result === 'idle') await sleep(2000);
  }
}

async function main(): Promise<void> {
  await ensureReposTable();
  const server = serve({ fetch: webhookApp.fetch, port: env.port });
  console.log(JSON.stringify({ level: 'info', msg: 'MergeWise started', port: env.port }));

  void startWorker();

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ level: 'info', msg: 'shutting down', signal }));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    level: 'error',
    msg: 'MergeWise failed to start',
    error: error instanceof Error ? error.message : String(error),
  }));
  await closePool();
  process.exit(1);
});
