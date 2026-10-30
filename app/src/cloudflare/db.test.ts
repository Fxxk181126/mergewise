import assert from 'node:assert/strict';
import test from 'node:test';

import { createCloudflareDeps, runScheduledJobs } from './db.js';
import type { D1Database, D1Result } from './types.js';

function d1<T>(result: T[]): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: result } satisfies D1Result<T>),
      }),
    }),
  } as unknown as D1Database;
}

test('maps D1 review rows to the shared review pipeline types', async () => {
  const deps = createCloudflareDeps(d1([{
    id: 'review-1',
    repo_id: 1842,
    pr_number: 7,
    head_sha: 'head-1',
  }]));

  const job = await deps.claimNextJob();
  assert.deepEqual(job, {
    id: 'review-1',
    repo_id: 1842n,
    pr_number: 7,
    head_sha: 'head-1',
  });
});

test('runs queued jobs until the D1 queue is idle', async () => {
  const calls: string[] = [];
  const results = await runScheduledJobs(
    {
      claimNextJob: async () => {
        calls.push('claim');
        return calls.length > 4 ? null : {
          id: String(calls.length),
          repo_id: 1n,
          pr_number: 1,
          head_sha: 'head',
        };
      },
    } as never,
    async () => {
      calls.push('run');
      return 'done';
    },
  );

  assert.deepEqual(results, ['done', 'done']);
  assert.deepEqual(calls, ['claim', 'run', 'claim', 'run', 'claim']);
});

test('passes the pinned job claimer to the scheduled callback', async () => {
  let claimCount = 0;
  const results = await runScheduledJobs(
    {
      claimNextJob: async () => {
        claimCount += 1;
        return claimCount > 2 ? null : {
          id: `review-${claimCount}`,
          repo_id: 1n,
          pr_number: 1,
          head_sha: 'head',
        };
      },
    },
    async (deps) => {
      const job = await deps.claimNextJob();
      assert.equal(job?.id, `review-${claimCount}`);
      return 'done';
    },
  );

  assert.deepEqual(results, ['done', 'done']);
});

test('fills required observation identity and timestamp columns', async () => {
  const bound: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        bound.push(args);
        return { run: async () => undefined };
      },
    }),
  } as unknown as D1Database;
  const deps = createCloudflareDeps(db);

  await deps.recordObservation(1842n, 7, 'head-1', { rule: 'token-in-url' });

  assert.equal(bound.length, 1);
  assert.match(String(bound[0][0]), /^[0-9a-f-]{36}$/);
  assert.equal(bound[0][1], '1842');
  assert.equal(bound[0][2], 7);
  assert.equal(bound[0][3], 'head-1');
  assert.equal(Number(bound[0][5]) > 0, true);
});

test('fills required rule stats timestamp on first publish', async () => {
  const bound: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        bound.push(args);
        return { run: async () => undefined };
      },
    }),
  } as unknown as D1Database;
  const deps = createCloudflareDeps(db);

  await deps.bumpPublishedCount(1842n, 'token-in-url');

  assert.equal(bound.length, 1);
  assert.equal(bound[0].length, 4);
  assert.equal(bound[0][0], '1842');
  assert.equal(bound[0][1], 'token-in-url');
  assert.equal(Number(bound[0][2]) > 0, true);
  assert.equal(Number(bound[0][3]) > 0, true);
});
