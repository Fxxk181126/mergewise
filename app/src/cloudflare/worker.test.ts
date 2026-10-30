import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import worker from './worker.js';
import type { D1Database } from './types.js';

function d1(): { db: D1Database; statements: { sql: string; values: unknown[] }[] } {
  const statements: { sql: string; values: unknown[] }[] = [];
  return {
    statements,
    db: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
          return {
            run: async () => ({ results: [] }),
            all: async () => ({ results: [{ id: 'review-1' }] }),
            first: async () => ({ id: 'review-1' }),
          };
        },
      }),
    } as unknown as D1Database,
  };
}

test('verifies GitHub pull_request webhooks and stores an idempotent job', async () => {
  const { db, statements } = d1();
  const payload = JSON.stringify({
    action: 'opened',
    installation: { id: 42 },
    repository: { id: 1842, full_name: 'owner/repo' },
    pull_request: { number: 7, draft: false, head: { sha: 'head-1' } },
  });
  const signature = 'sha256=' + crypto.createHmac('sha256', 'webhook-secret').update(payload).digest('hex');

  const response = await worker.fetch(new Request('https://worker.test/webhook', {
    method: 'POST',
    headers: { 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': signature },
    body: payload,
  }), { DB: db, WEBHOOK_SECRET: 'webhook-secret' });

  assert.equal(response.status, 200);
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /INSERT INTO repos/);
  assert.match(statements[1].sql, /INSERT INTO reviews/);
  assert.equal(typeof statements[1].values[0], 'string');
  assert.equal(statements[1].values[1], 1842);
  assert.equal(statements[1].values[2], 7);
  assert.equal(statements[1].values[3], 'head-1');
});

test('rejects invalid webhook signatures before touching D1', async () => {
  const { db, statements } = d1();
  const response = await worker.fetch(new Request('https://worker.test/webhook', {
    method: 'POST',
    headers: { 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': 'sha256=bad' },
    body: '{}',
  }), { DB: db, WEBHOOK_SECRET: 'webhook-secret' });

  assert.equal(response.status, 401);
  assert.equal(statements.length, 0);
});
