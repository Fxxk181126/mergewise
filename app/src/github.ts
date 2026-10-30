import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import crypto from 'node:crypto';
import { env } from './env.js';
import { TOKEN_TTL_MS } from './types.js';

const app = new App({ appId: env.githubAppId, privateKey: env.githubPrivateKey });

const tokenCache = new Map<bigint, { token: string; expiresAt: number }>();

export async function getInstallationToken(installationId: bigint): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const octokit = (await app.getInstallationOctokit(Number(installationId))) as Octokit;
  const auth = await octokit.auth() as { token: string };
  tokenCache.set(installationId, { token: auth.token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return auth.token;
}

async function getOctokit(installationId: bigint): Promise<Octokit> {
  const token = await getInstallationToken(installationId);
  return new Octokit({ auth: token });
}

export async function fetchDiffFiles(installationId: bigint, owner: string, repo: string, pr: number): Promise<{ files: { path: string; patch: string; additions: number; deletions: number }[]; headSha: string }> {
  const octokit = await getOctokit(installationId);
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: pr });
  const headSha = data.head.sha;

  const filesRes = await octokit.pulls.listFiles({ owner, repo, pull_number: pr, per_page: 100 });
  const files = filesRes.data
    .filter((f: any) => f.status !== 'removed')
    .map((f: any) => ({ path: f.filename, patch: f.patch ?? '', additions: f.additions, deletions: f.deletions }));

  return { files, headSha };
}

export async function getPullRequestHeadSha(installationId: bigint, owner: string, repo: string, pr: number): Promise<string> {
  const octokit = await getOctokit(installationId);
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: pr });
  return data.head.sha;
}

export async function findPublishedReviewId(
  installationId: bigint,
  owner: string,
  repo: string,
  pr: number,
  headSha: string,
): Promise<bigint | null> {
  const octokit = await getOctokit(installationId);
  const { data } = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: pr,
    per_page: 100,
  });
  const review = data.find((candidate) =>
    candidate.commit_id === headSha &&
    candidate.body?.startsWith('## MergeWise Review')
  );
  return review ? BigInt(review.id) : null;
}

export async function getReviewCommentBody(installationId: bigint, owner: string, repo: string, commentId: number): Promise<string | null> {
  const octokit = await getOctokit(installationId);
  const { data } = await octokit.pulls.getReviewComment({ owner, repo, comment_id: commentId });
  return data.body ?? null;
}

export async function createReview(installationId: bigint, owner: string, repo: string, pr: number, headSha: string, body: string, comments: { path: string; line: number; side?: string; start_line?: number; body: string }[]): Promise<bigint> {
  const octokit = await getOctokit(installationId);
  const { data } = await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: pr,
    commit_id: headSha,
    event: 'COMMENT' as any,
    body,
    comments: comments as any,
  });
  return BigInt(data.id);
}

export async function createSummaryOnlyReview(installationId: bigint, owner: string, repo: string, pr: number, headSha: string, body: string): Promise<bigint> {
  const octokit = await getOctokit(installationId);
  const { data } = await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: pr,
    commit_id: headSha,
    event: 'COMMENT' as any,
    body,
  });
  return BigInt(data.id);
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (expectedBytes.length !== actualBytes.length) return false;
  return crypto.timingSafeEqual(expectedBytes, actualBytes);
}
