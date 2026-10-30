import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLineMaps } from './diff.js';

test('maps GitHub file patch hunks to new-file line numbers', () => {
  const map = parseLineMaps([
    '@@ -1,3 +1,4 @@',
    ' unchanged',
    '-removed',
    '+const id = req.query.id;',
    ' unchanged',
    '+return id;',
  ].join('\n'));

  assert.equal(map[1], 'unchanged');
  assert.equal(map[2], 'const id = req.query.id;');
  assert.equal(map[3], 'unchanged');
  assert.equal(map[4], 'return id;');
});
