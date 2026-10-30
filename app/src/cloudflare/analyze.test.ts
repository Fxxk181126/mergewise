import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze } from './analyze.js';

test('sends a Cloudflare-compatible LLM request and validates findings', async () => {
  const requestBody = {
    findings: [{
      file: 'src/app.ts',
      line: 3,
      quote: 'const token = url.search',
      severity: 'security',
      confidence: 95,
      rule: 'token-in-url',
      title: 'Token exposed',
      why: 'The URL is logged by intermediaries.',
      suggestion: 'Read the token from an Authorization header instead.',
    }],
  };
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: input.toString(), init: init ?? {} });
    return new Response(JSON.stringify({
      choices: [{ message: { content: `noise\n${JSON.stringify(requestBody)}\nnoise` } }],
    }));
  };

  const findings = await analyze([{ path: 'src/app.ts', patch: '@@ -1,3 +1,3 @@\n+const token = url.search', additions: 1, deletions: 0 }], {
    baseUrl: 'https://llm.example',
    apiKey: 'llm-key',
    model: 'test-model',
    fetchImpl,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://llm.example/chat/completions');
  assert.equal(new Headers(requests[0].init.headers).get('Authorization'), 'Bearer llm-key');
  assert.equal(JSON.parse(String(requests[0].init.body)).model, 'test-model');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'token-in-url');
});

test('normalizes fractional model confidence before schema validation', async () => {
  const warnings: string[] = [];
  const body = {
    findings: [{
      file: 'src/app.ts',
      line: 3,
      quote: 'const token = url.search',
      severity: 'security',
      confidence: 0.95,
      rule: 'token-in-url',
      title: 'Token exposed',
      why: 'The URL is logged by intermediaries.',
      suggestion: 'Read the token from an Authorization header instead.',
    }],
  };
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(body) } }],
  }));

  const findings = await analyze([{ path: 'src/app.ts', patch: '@@ -1,3 +1,3 @@\n+const token = url.search', additions: 1, deletions: 0 }], {
    baseUrl: 'https://llm.example',
    apiKey: 'llm-key',
    model: 'test-model',
    logger: { warn: (message) => warnings.push(message) },
    fetchImpl,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, 95);
  assert.equal(warnings.length, 0);
});

test('normalizes common Chinese field names before schema validation', async () => {
  const body = {
    findings: [{
      文件: 'docs/mergewise-trigger-fixture.js',
      行号: 2,
      原文: 'https://api.example.com/v1?token=...',
      severity: 'security',
      置信度: 0.96,
      rule: 'token-in-url',
      标题: `${'Token exposed in URL'.padEnd(85, 'x')}`,
      原因: `${'Query tokens can leak through logs and referrers.'.padEnd(205, 'x')}`,
      修复建议: 'Move the token to an Authorization header.',
    }],
  };
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(body) } }],
  }));

  const findings = await analyze([{ path: 'docs/mergewise-trigger-fixture.js', patch: '@@ -1,2 +1,3 @@\n+export const endpoint = "...";', additions: 1, deletions: 0 }], {
    baseUrl: 'https://llm.example',
    apiKey: 'llm-key',
    model: 'test-model',
    fetchImpl,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'docs/mergewise-trigger-fixture.js');
  assert.equal(findings[0].line, 2);
  assert.equal(findings[0].confidence, 96);
  assert.equal(findings[0].title.length <= 80, true);
  assert.equal(findings[0].why.length <= 200, true);
});

test('resolves a missing model file name from a single code file diff', async () => {
  const body = {
    findings: [{
      file: 'undefined',
      line: 3,
      quote: 'the token literal on line 3',
      severity: 'security',
      confidence: 95,
      rule: 'token-in-url',
      title: 'Token exposed',
      why: 'The URL is logged by intermediaries.',
    }],
  };
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(body) } }],
  }));

  const findings = await analyze([
    { path: 'docs/fixture.md', patch: '@@ -1 +1,2 @@\n+fixture notes', additions: 1, deletions: 0 },
    { path: 'docs/fixture.js', patch: '@@ -1,3 +1,3 @@\n+  "https://api.example.com/v1?token=..."', additions: 1, deletions: 0 },
  ], {
    baseUrl: 'https://llm.example',
    apiKey: 'llm-key',
    model: 'test-model',
    fetchImpl,
  });

  assert.equal(findings[0].file, 'docs/fixture.js');
});
