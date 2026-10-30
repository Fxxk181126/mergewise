import { Hono } from 'hono';
import { env } from './env.js';
import { getReviewCommentBody, verifyWebhookSignature } from './github.js';
import { insertReviewJob, getRepo, upsertRepo, bumpFalsePositive, checkAutoMute } from './db.js';
import { resolveMutedRule } from './mute.js';

const app = new Hono();

app.post('/webhook', async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header('X-Hub-Signature-256') ?? '';
  const event = c.req.header('X-GitHub-Event') ?? '';
  const delivery = c.req.header('X-GitHub-Delivery') ?? 'unknown';

  if (!verifyWebhookSignature(raw, signature, env.webhookSecret)) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'bad signature', delivery }));
    return c.text('bad signature', 401);
  }

  const payload = JSON.parse(raw);

  if (event === 'pull_request') {
    const action = payload.action;
    if (action !== 'opened' && action !== 'synchronize') return c.text('ignored', 200);
    if (payload.pull_request?.draft) return c.text('draft skipped', 200);

    const repoId = BigInt(payload.repository.id);
    const installationId = BigInt(payload.installation.id);
    const fullName = payload.repository.full_name as string;
    const pr = payload.pull_request.number as number;
    const sha = payload.pull_request.head.sha as string;

    await upsertRepo(installationId, repoId, fullName);
    const inserted = await insertReviewJob(repoId, pr, sha);
    console.log(JSON.stringify({ level: 'info', msg: 'job created', delivery, repo: fullName, pr, sha, inserted }));
    return c.text('ok', 200);
  }

  if (event === 'issue_comment' || event === 'pull_request_review_comment') {
    const action = payload.action;
    if (action !== 'created') return c.text('ignored', 200);
    const comment = payload.comment;
    if (!comment || comment.user?.type === 'Bot') return c.text('bot comment skipped', 200);

    const body = (comment.body ?? '').trim();
    if (!body.startsWith('@mergewise mute this')) return c.text('ignored', 200);

    const repoId = BigInt(payload.repository.id);
    const repo = await getRepo(repoId);
    if (!repo) return c.text('repo not found', 200);

    const inReplyToId = event === 'pull_request_review_comment'
      ? payload.comment.in_reply_to_id
      : null;
    const rule = await resolveMutedRule({
      body,
      ...(inReplyToId ? {
        inReplyTo: async () => {
          const [owner, repoName] = payload.repository.full_name.split('/');
          return { body: await getReviewCommentBody(BigInt(payload.installation.id), owner, repoName, Number(inReplyToId)) ?? '' };
        },
      } : {}),
    });

    if (rule) {
      await bumpFalsePositive(repoId, rule);
      const isMuted = await checkAutoMute(repoId, rule);
      console.log(JSON.stringify({ level: 'info', msg: 'mute processed', rule, autoMuted: isMuted }));
      return c.text('ok', 200);
    }

    console.warn(JSON.stringify({ level: 'warn', msg: 'mute command missing rule', delivery }));
    return c.text('rule not found', 200);
  }

  return c.text('ignored', 200);
});

app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

export default app;
