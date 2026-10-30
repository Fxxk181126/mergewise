import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';

test('verifies valid and malformed webhook signatures without throwing', async () => {
  process.env.WEBHOOK_SECRET = 'webhook-secret';
  process.env.GITHUB_APP_ID = '1';
  process.env.GITHUB_PRIVATE_KEY = 'not-a-real-key';
  process.env.LLM_API_KEY = 'test';

  const { verifyWebhookSignature } = await import('./github.js');
  const payload = '{"action":"opened"}';
  const signature = 'sha256=' + createHmac('sha256', 'webhook-secret').update(payload).digest('hex');

  assert.equal(verifyWebhookSignature(payload, signature, 'webhook-secret'), true);
  assert.equal(verifyWebhookSignature(payload, 'sha256=bad', 'webhook-secret'), false);
});
