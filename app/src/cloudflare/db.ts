import type { ClaimedJob, WorkerDeps } from '../worker.js';
import type { ReviewMode } from '../types.js';
import type { D1Database } from './types.js';

interface ReviewRow {
  id: string;
  repo_id: number | bigint | string;
  pr_number: number;
  head_sha: string;
}

interface RepoRow {
  installation_id: number | bigint | string;
  full_name: string;
  threshold: number;
  mode: string;
}

function asId(value: number | bigint | string): bigint {
  return BigInt(value);
}

export function createCloudflareDeps(db: D1Database): Pick<WorkerDeps,
  'claimNextJob' | 'getRepo' | 'getRuleState' | 'recordObservation' |
  'bumpPublishedCount' | 'updateReviewStatus'> {
  return {
    async claimNextJob(): Promise<ClaimedJob | null> {
      const now = Date.now();
      const result = await db.prepare(`
        UPDATE reviews
        SET status = 'running', started_at = ?
        WHERE id = (
          SELECT id FROM reviews
          WHERE status = 'pending' OR (status = 'running' AND started_at < ?)
          ORDER BY created_at ASC
          LIMIT 1
        )
        RETURNING id, repo_id, pr_number, head_sha
      `).bind(now + 5 * 60 * 1000, now).all<ReviewRow>();
      const job = result.results[0] ?? null;

      return job && {
        id: job.id,
        repo_id: asId(job.repo_id),
        pr_number: Number(job.pr_number),
        head_sha: job.head_sha,
      };
    },

    async getRepo(repoId: bigint) {
      const repo = await db.prepare(`
        SELECT installation_id, full_name, threshold, mode
        FROM repos WHERE id = ?
      `).bind(repoId.toString()).first<RepoRow>();
      if (!repo) return null;

      return {
        installation_id: asId(repo.installation_id),
        full_name: repo.full_name,
        threshold: Number(repo.threshold),
        mode: repo.mode as ReviewMode,
      };
    },

    async getRuleState(repoId: bigint, rule: string): Promise<string> {
      const row = await db.prepare(`
        SELECT auto_state FROM rule_stats WHERE repo_id = ? AND rule = ?
      `).bind(repoId.toString(), rule).first<{ auto_state: string }>();
      return row?.auto_state ?? 'active';
    },

    async recordObservation(repoId: bigint, pr: number, sha: string, finding: unknown) {
      await db.prepare(`
        INSERT INTO observations (id, repo_id, pr_number, head_sha, finding, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        repoId.toString(),
        pr,
        sha,
        JSON.stringify(finding),
        Date.now(),
      ).run();
    },

    async bumpPublishedCount(repoId: bigint, rule: string) {
      await db.prepare(`
        INSERT INTO rule_stats (repo_id, rule, published_count, updated_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT (repo_id, rule) DO UPDATE SET
          published_count = rule_stats.published_count + 1,
          updated_at = ?
      `).bind(repoId.toString(), rule, Date.now(), Date.now()).run();
    },

    async updateReviewStatus(id: string, status: string, findings?: unknown[], postedReviewId?: bigint) {
      await db.prepare(`
        UPDATE reviews
        SET status = ?, findings = ?, posted_review_id = ?
        WHERE id = ?
      `).bind(
        status,
        findings ? JSON.stringify(findings) : null,
        postedReviewId?.toString() ?? null,
        id,
      ).run();
    },
  };
}

export async function upsertRepo(
  db: D1Database,
  repo: { repoId: bigint; installationId: bigint; fullName: string; threshold: number },
): Promise<void> {
  await db.prepare(`
    INSERT INTO repos (id, installation_id, full_name, threshold, mode, shadow_started_at)
    VALUES (?, ?, ?, ?, 'shadow', ?)
    ON CONFLICT (id) DO UPDATE SET installation_id = excluded.installation_id, full_name = excluded.full_name
  `).bind(
    repo.repoId.toString(),
    repo.installationId.toString(),
    repo.fullName,
    repo.threshold,
    Date.now(),
  ).run();
}

export async function insertReviewJob(
  db: D1Database,
  job: { repoId: bigint; pr: number; sha: string },
): Promise<boolean> {
  const row = await db.prepare(`
    INSERT INTO reviews (id, repo_id, pr_number, head_sha, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (repo_id, pr_number, head_sha) DO NOTHING
    RETURNING id
  `).bind(
    crypto.randomUUID(),
    Number(job.repoId),
    job.pr,
    job.sha,
    Date.now(),
  ).first<{ id: string }>();
  return row !== null;
}

export async function getRepo(db: D1Database, repoId: bigint) {
  return await createCloudflareDeps(db).getRepo(repoId);
}

export async function bumpFalsePositive(db: D1Database, repoId: bigint, rule: string): Promise<void> {
  await db.prepare(`
    INSERT INTO rule_stats (repo_id, rule, published_count, false_positive_count)
    VALUES (?, ?, 1, 1)
    ON CONFLICT (repo_id, rule) DO UPDATE SET
      false_positive_count = rule_stats.false_positive_count + 1,
      updated_at = ?
  `).bind(repoId.toString(), rule, Date.now()).run();
}

export async function isRuleMuted(db: D1Database, repoId: bigint, rule: string): Promise<boolean> {
  const row = await db.prepare(`
    UPDATE rule_stats
    SET auto_state = CASE
      WHEN published_count > 0 AND false_positive_count * 100 > published_count * 30 THEN 'muted'
      ELSE auto_state
    END
    WHERE repo_id = ? AND rule = ?
    RETURNING auto_state
  `).bind(repoId.toString(), rule).first<{ auto_state: string }>();
  return row?.auto_state === 'muted';
}

export async function runScheduledJobs<T extends Pick<WorkerDeps, 'claimNextJob'>>(
  deps: T,
  runOnce: (deps: T & Pick<WorkerDeps, 'claimNextJob'>) => Promise<'idle' | 'done' | 'skipped' | 'failed'>,
  maxJobs = 3,
): Promise<Array<'idle' | 'done' | 'skipped' | 'failed'>> {
  const results: Array<'idle' | 'done' | 'skipped' | 'failed'> = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const claimed = await deps.claimNextJob();
    if (!claimed) break;
    results.push(await runOnce({
      ...deps,
      claimNextJob: async () => claimed,
    }));
  }
  return results;
}
