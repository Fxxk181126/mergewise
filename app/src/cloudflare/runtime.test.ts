import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { verifyWebhookSignature } from './runtime.js';

const payload = JSON.stringify({ action: 'opened', repository: { id: 1 } });
const secret = 'webhook-secret';

test('accepts a GitHub HMAC signature generated with the shared secret', () => {
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(verifyWebhookSignature(payload, signature, secret), true);
});

test('rejects invalid signatures without throwing', () => {
  const signature = 'sha256=' + crypto.createHmac('sha256', 'other-secret').update(payload).digest('hex');
  assert.equal(verifyWebhookSignature(payload, signature, secret), false);
  assert.equal(verifyWebhookSignature(payload, 'not-a-signature', secret), false);
});
