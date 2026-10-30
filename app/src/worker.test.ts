import assert from 'node:assert/strict';
import test from 'node:test';

import { runOnce } from './worker.js';
import type { AnchoredFinding, DiffFile, RepoRecord } from './types.js';

const repo: RepoRecord = {
  id: 101n,
  installation_id: 9001n,
  full_name: 'acme/payments',
  threshold: 80,
  mode: 'commenting',
  shadow_started_at: null,
};

const diff: DiffFile = {
  path: 'src/api/invoices.ts',
  patch: '@@ -1,2 +1,3 @@\n old\n+const id = req.query.id;\n unchanged',
  additions: 1,
  deletions: 0,
};

function finding(overrides: Partial<AnchoredFinding> = {}): AnchoredFinding {
  return {
    file: diff.path,
    line: 2,
    quote: 'const id = req.query.id;',
    severity: 'security',
    confidence: 97,
    rule: 'sql-injection/v3',
    title: 'SQL injection',
    why: 'User input is interpolated into a query.',
    anchored: true,
    ...overrides,
  };
}

function createDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      claimNextJob: async () => {
        calls.push('claim');
        return { id: 'review-1', repo_id: repo.id, pr_number: 1842, head_sha: 'head-1' };
      },
      getRepo: async () => repo,
      getCurrentHeadSha: async () => {
        calls.push('head');
        return 'head-1';
      },
      fetchDiffFiles: async () => {
        calls.push('diff');
        return { files: [diff], headSha: 'head-1' };
      },
      analyze: async () => {
        calls.push('analyze');
        return [
          finding(),
          finding({ severity: 'bug', confidence: 88, rule: 'race/v1', line: 2 }),
          finding({ severity: 'test', confidence: 40, rule: 'missing-test/v1' }),
        ];
      },
      getRuleState: async (_repoId: bigint, rule: string) => {
        calls.push(`rule:${rule}`);
        return 'active';
      },
      recordObservation: async () => calls.push('observe'),
      bumpPublishedCount: async () => calls.push('published'),
      createReview: async (...args: unknown[]) => {
        calls.push(`review:${JSON.stringify(args[6])}`);
        return 1n;
      },
      createSummaryOnlyReview: async () => {
        calls.push('summary');
        return 1n;
      },
      findPublishedReviewId: async () => null,
      updateReviewStatus: async (id: string, status: string) => calls.push(`status:${id}:${status}`),
      ...overrides,
    } as any,
  };
}

test('commenting mode publishes one inline and records the rest of the noise budget', async () => {
  const { deps, calls } = createDeps();
  const result = await runOnce(deps);

  assert.equal(result, 'done');
  assert.match(calls.join('|'), /review:\[{"path":"src\/api\/invoices.ts","line":2/);
  assert.equal(calls.filter((call) => call.startsWith('review:')).length, 1);
  assert.equal(calls.filter((call) => call === 'published').length, 2);
  assert.match(calls.join('|'), /observe/);
  assert.match(calls.join('|'), /status:review-1:done/);
});

test('shadow mode records eligible findings and does not publish comments', async () => {
  const { deps, calls } = createDeps({
    getRepo: async () => ({ ...repo, mode: 'shadow' }),
    createReview: async () => {
      throw new Error('must not create a review');
    },
  });

  assert.equal(await runOnce(deps), 'done');
  assert.equal(calls.filter((call) => call === 'observe').length, 3);
  assert.ok(!calls.includes('summary'));
});

test('a stale head is skipped before any publish', async () => {
  const { deps, calls } = createDeps({ getCurrentHeadSha: async () => 'head-2' });

  assert.equal(await runOnce(deps), 'skipped');
  assert.match(calls.join('|'), /status:review-1:skipped/);
  assert.ok(!calls.includes('analyze'));
});

test('LLM failure degrades to one summary review instead of failing the PR review', async () => {
  const { deps, calls } = createDeps({
    analyze: async () => {
      throw new Error('LLM output failed schema validation');
    },
    createReview: async () => {
      throw new Error('must not create an inline review');
    },
  });

  assert.equal(await runOnce(deps), 'done');
  assert.match(calls.join('|'), /summary/);
  assert.ok(!calls.some((call) => call.startsWith('review:')));
  assert.match(calls.join('|'), /status:review-1:done/);
});

test('multi-line comments end on the final changed line', async () => {
  let comment: any;
  const { deps } = createDeps({
    analyze: async () => [finding({ endLine: 3 })],
    createReview: async (...args: unknown[]) => {
      comment = args[6];
      return 1n;
    },
  });

  assert.equal(await runOnce(deps), 'done');
  assert.equal(comment[0].start_line, 2);
  assert.equal(comment[0].line, 3);
});

test('a GitHub 422 degrades to summary-only publication so one bad anchor cannot fail the PR', async () => {
  const { deps, calls } = createDeps({
    createReview: async () => {
      const error = new Error('Validation Failed');
      (error as any).status = 422;
      throw error;
    },
  });

  assert.equal(await runOnce(deps), 'done');
  assert.match(calls.join('|'), /summary/);
  assert.match(calls.join('|'), /status:review-1:done/);
});

test('persists the published review before recording optional rule stats', async () => {
  const calls: string[] = [];
  const { deps } = createDeps({
    updateReviewStatus: async (id: string, status: string, findings: unknown, reviewId?: bigint) => {
      calls.push(`status:${id}:${status}:${reviewId ?? 'none'}`);
    },
    bumpPublishedCount: async () => {
      calls.push('published');
      throw new Error('stats temporarily unavailable');
    },
  });

  const result = await runOnce(deps);

  assert.equal(result, 'done');
  assert.match(calls.join('|'), /status:review-1:done:1/);
  assert.ok(calls.indexOf('status:review-1:done:1') < calls.indexOf('published'));
});

test('does not publish again when the same head already has a MergeWise review', async () => {
  const { deps, calls } = createDeps({
    findPublishedReviewId: async (...args: unknown[]) => {
      calls.push(`existing:${args.join(',')}`);
      return 55n;
    },
    createReview: async () => {
      throw new Error('must not create a second review');
    },
    updateReviewStatus: async (id: string, status: string, findings: unknown, reviewId?: bigint) => {
      calls.push(`status:${id}:${status}:${reviewId ?? 'none'}`);
    },
  });

  const result = await runOnce(deps);

  assert.equal(result, 'done');
  assert.match(calls.join('|'), /existing:9001,acme,payments,1842,head-1/);
  assert.ok(!calls.some((call) => call.startsWith('review:')));
  assert.match(calls.join('|'), /status:review-1:done:55/);
});
