import { Hono } from 'hono';

import { resolveMutedRule } from '../mute.js';
import { runOnce, type WorkerDeps } from '../worker.js';
import { analyze } from './analyze.js';
import {
  bumpFalsePositive,
  createCloudflareDeps,
  getRepo,
  insertReviewJob,
  isRuleMuted,
  runScheduledJobs,
  upsertRepo,
} from './db.js';
import { createGitHubClient } from './github.js';
import type { D1Database } from './types.js';
import { verifyWebhookSignature } from './runtime.js';

interface WorkerEnv {
  DB: D1Database;
  WEBHOOK_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY: string;
  LLM_MODEL?: string;
  DEFAULT_THRESHOLD?: string;
}

interface ScheduledContext {
  waitUntil(promise: Promise<unknown>): void;
}

function githubConfig(env: WorkerEnv) {
  return { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY };
}

const app = new Hono<{ Bindings: WorkerEnv }>();

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

app.post('/webhook', async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header('X-Hub-Signature-256') ?? '';
  const event = c.req.header('X-GitHub-Event') ?? '';
  const delivery = c.req.header('X-GitHub-Delivery') ?? 'unknown';

  if (!verifyWebhookSignature(payload, signature, c.env.WEBHOOK_SECRET)) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'bad signature', delivery }));
    return c.text('bad signature', 401);
  }

  const body = JSON.parse(payload);

  if (event === 'pull_request') {
    if (body.action !== 'opened' && body.action !== 'synchronize') return c.text('ignored');
    if (body.pull_request?.draft) return c.text('draft skipped');

    await upsertRepo(c.env.DB, {
      repoId: BigInt(body.repository.id),
      installationId: BigInt(body.installation.id),
      fullName: body.repository.full_name,
      threshold: Number(c.env.DEFAULT_THRESHOLD ?? '80'),
    });
    const inserted = await insertReviewJob(c.env.DB, {
      repoId: BigInt(body.repository.id),
      pr: Number(body.pull_request.number),
      sha: body.pull_request.head.sha,
    });
    console.log(JSON.stringify({ level: 'info', msg: 'job created', delivery, inserted }));
    return c.text('ok');
  }

  if (event === 'issue_comment' || event === 'pull_request_review_comment') {
    if (body.action !== 'created') return c.text('ignored');
    const comment = body.comment;
    if (!comment || comment.user?.type === 'Bot') return c.text('bot comment skipped');

    const command = (comment.body ?? '').trim();
    if (!command.startsWith('@mergewise mute this')) return c.text('ignored');

    const repoId = BigInt(body.repository.id);
    const repo = await getRepo(c.env.DB, repoId);
    if (!repo) return c.text('repo not found');

    const inReplyToId = event === 'pull_request_review_comment' ? comment.in_reply_to_id : null;
    const [owner, repoName] = body.repository.full_name.split('/');
    const github = createGitHubClient(githubConfig(c.env));
    const rule = await resolveMutedRule({
      body: command,
      ...(inReplyToId ? {
        inReplyTo: async () => ({
          body: await github.getReviewCommentBody(
            BigInt(body.installation.id),
            owner,
            repoName,
            Number(inReplyToId),
          ) ?? '',
        }),
      } : {}),
    });
    if (!rule) return c.text('rule not found');

    await bumpFalsePositive(c.env.DB, repoId, rule);
    const muted = await isRuleMuted(c.env.DB, repoId, rule);
    console.log(JSON.stringify({ level: 'info', msg: 'mute processed', rule, muted }));
    return c.text('ok');
  }

  return c.text('ignored');
});

async function scheduled(env: WorkerEnv): Promise<void> {
  const github = createGitHubClient(githubConfig(env));
  const dbDeps = createCloudflareDeps(env.DB);
  const deps: WorkerDeps = {
    ...dbDeps,
    getCurrentHeadSha: github.getCurrentHeadSha,
    fetchDiffFiles: github.fetchDiffFiles,
    analyze: (files) => analyze(files, {
      baseUrl: env.LLM_BASE_URL ?? 'https://api.deepseek.com',
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL ?? 'deepseek-chat',
      logger: console,
    }),
    createReview: github.createReview,
    createSummaryOnlyReview: github.createSummaryOnlyReview,
    findPublishedReviewId: github.findPublishedReviewId,
  };
  const results = await runScheduledJobs(
    dbDeps,
    async (pinnedDeps) => await runOnce({ ...deps, claimNextJob: pinnedDeps.claimNextJob }),
    3,
  );
  console.log(JSON.stringify({ level: 'info', msg: 'scheduled jobs complete', results }));
}

export default {
  fetch: app.fetch,
  async scheduled(controller: { cron: string }, env: WorkerEnv, context: ScheduledContext) {
    context.waitUntil(scheduled(env));
  },
};
