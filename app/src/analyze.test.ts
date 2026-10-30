import assert from 'node:assert/strict';
import test from 'node:test';

const files = [{
  path: 'src/api/invoices.ts',
  patch: '@@ -1,1 +1,2 @@\n old\n+const id = req.query.id;',
  additions: 1,
  deletions: 0,
}];

process.env.WEBHOOK_SECRET = 'test';
process.env.GITHUB_APP_ID = '1';
process.env.GITHUB_PRIVATE_KEY = 'not-a-real-key';
process.env.LLM_API_KEY = 'test';

const validResponse = {
  choices: [{ message: { content: JSON.stringify({
    findings: [{
      file: 'src/api/invoices.ts',
      line: 2,
      quote: 'const id = req.query.id;',
      severity: 'security',
      confidence: 97,
      rule: 'sql-injection/v3',
      title: 'SQL injection',
      why: 'Request input is interpolated into SQL.',
      suggestion: 'Use a parameterized query.',
    }],
  }) } }],
};

test('retries one time when the first LLM payload is not valid JSON', async () => {
  process.env.WEBHOOK_SECRET = 'test';
  process.env.GITHUB_APP_ID = '1';
  process.env.GITHUB_PRIVATE_KEY = 'not-a-real-key';
  process.env.LLM_API_KEY = 'test';

  const calls: unknown[] = [];
  const fetchImpl = (async (_url: any, init: any) => {
    calls.push(JSON.parse(init.body));
    return calls.length === 1
      ? new Response('not json', { status: 200 })
      : new Response(JSON.stringify(validResponse), { status: 200 });
  }) as typeof fetch;

  const { analyze } = await import('./analyze.js');
  const findings = await analyze(files, { fetchImpl, logger: { warn() {} } });

  assert.equal(findings.length, 1);
  assert.equal(calls.length, 2);
});

test('labels prompt lines with new-file line numbers and keeps deletions unnumbered', async () => {
  const { formatPatchForLLM } = await import('./analyze.js');
  const formatted = formatPatchForLLM([
    '@@ -1,2 +1,2 @@',
    ' old',
    '-removed',
    '+const id = req.query.id;',
  ].join('\n'));

  assert.match(formatted, /@@ -1,2 \+1,2 @@/);
  assert.match(formatted, /(^|\n)1:  old/);
  assert.match(formatted, /(^|\n)-: -removed/);
  assert.match(formatted, /(^|\n)2: \+const id = req\.query\.id;/);
});
