import pg from 'pg';
import { env } from './env.js';

const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 5 });

export async function ensureReposTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repos (
      id BIGINT PRIMARY KEY,
      installation_id BIGINT NOT NULL,
      full_name TEXT NOT NULL,
      threshold INT NOT NULL DEFAULT 80,
      mode TEXT NOT NULL DEFAULT 'shadow',
      shadow_started_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      repo_id BIGINT NOT NULL REFERENCES repos(id),
      pr_number INT NOT NULL,
      head_sha TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TIMESTAMPTZ,
      findings JSONB,
      posted_review_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (repo_id, pr_number, head_sha)
    );
    CREATE TABLE IF NOT EXISTS observations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      repo_id BIGINT NOT NULL REFERENCES repos(id),
      pr_number INT NOT NULL,
      head_sha TEXT NOT NULL,
      finding JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS rule_stats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      repo_id BIGINT NOT NULL REFERENCES repos(id),
      rule TEXT NOT NULL,
      published_count INT NOT NULL DEFAULT 0,
      false_positive_count INT NOT NULL DEFAULT 0,
      auto_state TEXT NOT NULL DEFAULT 'active',
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (repo_id, rule)
    );
  `);
}

export async function upsertRepo(installationId: bigint, repoId: bigint, fullName: string): Promise<void> {
  await pool.query(
    `INSERT INTO repos (id, installation_id, full_name, threshold, mode, shadow_started_at)
     VALUES ($1, $2, $3, $4, 'shadow', now())
     ON CONFLICT (id) DO UPDATE SET installation_id = $2, full_name = $3`,
    [repoId, installationId, fullName, env.defaultThreshold]
  );
}

export async function getRepo(repoId: bigint) {
  const r = await pool.query('SELECT * FROM repos WHERE id = $1', [repoId]);
  return r.rows[0] ?? null;
}

export async function insertReviewJob(repoId: bigint, pr: number, sha: string): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO reviews (repo_id, pr_number, head_sha) VALUES ($1, $2, $3)
     ON CONFLICT (repo_id, pr_number, head_sha) DO NOTHING RETURNING id`,
    [repoId, pr, sha]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function claimNextJob() {
  const r = await pool.query(
    `UPDATE reviews SET status = 'running', started_at = now()
     WHERE id = (
       SELECT id FROM reviews
       WHERE status = 'pending'
          OR (status = 'running' AND started_at < now() - interval '5 minutes')
       ORDER BY created_at ASC LIMIT 1
       FOR UPDATE SKIP LOCKED
     ) RETURNING *`
  );
  return r.rows[0] ?? null;
}

export async function updateReviewStatus(id: string, status: string, findings?: unknown[], postedReviewId?: bigint) {
  await pool.query(
    `UPDATE reviews SET status = $2, findings = $3, posted_review_id = $4 WHERE id = $1`,
    [id, status, findings ? JSON.stringify(findings) : null, postedReviewId ?? null]
  );
}

export async function recordObservation(repoId: bigint, pr: number, sha: string, finding: unknown) {
  await pool.query(
    `INSERT INTO observations (repo_id, pr_number, head_sha, finding) VALUES ($1, $2, $3, $4)`,
    [repoId, pr, sha, JSON.stringify(finding)]
  );
}

export async function bumpPublishedCount(repoId: bigint, rule: string) {
  await pool.query(
    `INSERT INTO rule_stats (repo_id, rule, published_count) VALUES ($1, $2, 1)
     ON CONFLICT (repo_id, rule) DO UPDATE SET published_count = rule_stats.published_count + 1, updated_at = now()`,
    [repoId, rule]
  );
}

export async function bumpFalsePositive(repoId: bigint, rule: string) {
  await pool.query(
    `INSERT INTO rule_stats (repo_id, rule, published_count, false_positive_count) VALUES ($1, $2, 1, 1)
     ON CONFLICT (repo_id, rule) DO UPDATE SET false_positive_count = rule_stats.false_positive_count + 1, updated_at = now()`,
    [repoId, rule]
  );
}

export async function getRuleState(repoId: bigint, rule: string): Promise<string> {
  const r = await pool.query(
    `SELECT auto_state FROM rule_stats WHERE repo_id = $1 AND rule = $2`,
    [repoId, rule]
  );
  return r.rows[0]?.auto_state ?? 'active';
}

export async function checkAutoMute(repoId: bigint, rule: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE rule_stats SET auto_state = CASE
       WHEN published_count > 0 AND false_positive_count::float / published_count > 0.30 THEN 'muted'
       ELSE auto_state END,
       updated_at = now()
     WHERE repo_id = $1 AND rule = $2
     RETURNING auto_state`,
    [repoId, rule]
  );
  return r.rows[0]?.auto_state === 'muted';
}

export function closePool() {
  return pool.end();
}
