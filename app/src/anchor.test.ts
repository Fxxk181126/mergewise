import assert from 'node:assert/strict';
import test from 'node:test';

import { anchor } from './anchor.js';

const lineMaps = {
  'src/app.ts': {
    2: 'if (!user) {',
    3: '  return null;',
    4: '}',
  },
};

function finding(overrides: Record<string, unknown> = {}) {
  return {
    file: 'src/app.ts',
    line: 2,
    quote: 'if (!user) {',
    severity: 'bug' as const,
    confidence: 90,
    rule: 'null-check/v1',
    title: 'Missing guard',
    why: 'The guard returns no value.',
    ...overrides,
  };
}

test('validates an end line and preserves a multi-line range', () => {
  const result = anchor([finding({ endLine: 4 })], lineMaps);
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].endLine, 4);
});

test('accepts a single-line finding with equal start and end lines', () => {
  const result = anchor([finding({ line: 3, quote: 'return null;', endLine: 3 })], lineMaps);
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].line, 3);
  assert.equal(result.valid[0].endLine, 3);
});

test('rejects an end line outside the diff or before the start line', () => {
  for (const endLine of [1, 9]) {
    const result = anchor([finding({ endLine })], lineMaps);
    assert.equal(result.valid.length, 0);
    assert.equal(result.invalid.length, 1);
  }
});
