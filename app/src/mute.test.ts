import assert from 'node:assert/strict';
import test from 'node:test';

import { extractRule, resolveMutedRule } from './mute.js';

test('extracts an explicit rule from a command comment', () => {
  assert.equal(extractRule('@mergewise mute this rule: sql-injection/v3'), 'sql-injection/v3');
});

test('locates the rule on the original inline comment when a user only replies with the command', async () => {
  const rule = await resolveMutedRule({
    body: '@mergewise mute this',
    inReplyTo: async () => ({
      body: 'MergeWise inline\n> 回复 @mergewise mute this 静音此类 · rule: `sql-injection/v3`',
    }),
  });

  assert.equal(rule, 'sql-injection/v3');
});

test('returns null when neither the reply nor parent identifies a rule', async () => {
  const rule = await resolveMutedRule({ body: '@mergewise mute this', inReplyTo: async () => ({ body: 'no rule' }) });
  assert.equal(rule, null);
});
