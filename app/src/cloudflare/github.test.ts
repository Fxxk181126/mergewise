import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';

import { createAppToken, createGitHubClient } from './github.js';

test('creates a signed GitHub App JWT', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuedAt = Date.parse('2026-10-28T01:00:00.000Z');
  const token = await createAppToken({
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }, issuedAt);
  const [headerPart, claimsPart, signaturePart] = token.split('.');
  const decode = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString());

  assert.deepEqual(decode(headerPart), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(decode(claimsPart), {
    iat: issuedAt / 1000 - 60,
    exp: issuedAt / 1000 + 600,
    iss: '123',
  });

  const signatureInput = `${headerPart}.${claimsPart}`;
  const verified = crypto.createVerify('RSA-SHA256')
    .update(signatureInput)
    .verify(publicKey, Buffer.from(signaturePart, 'base64url'));
  assert.equal(verified, true);
});

test('accepts PEM private keys whose newlines were stored as escaped sequences', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const escapedPrivateKey = privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
    .replace(/\n/g, '\\n');

  const token = await createAppToken({ appId: '123', privateKey: escapedPrivateKey });
  assert.equal(token.split('.').length, 3);
});

test('signs GitHub App JWTs with PKCS#1 private keys', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuedAt = Date.parse('2026-10-28T02:00:00.000Z');
  const token = await createAppToken({
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  }, issuedAt);

  const signatureInput = token.split('.').slice(0, 2).join('.');
  const signature = Buffer.from(token.split('.')[2], 'base64url');
  const verified = crypto.createVerify('RSA-SHA256')
    .update(signatureInput)
    .verify(publicKey, signature);
  assert.equal(verified, true);
});

test('exchanges and caches installation tokens', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const requests: { url: string; authorization: string | null; userAgent: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: input.toString(),
      authorization: new Headers(init?.headers).get('Authorization'),
      userAgent: new Headers(init?.headers).get('User-Agent'),
    });
    return new Response(JSON.stringify({ token: 'installation-token', expires_at: new Date(Date.now() + 3_600_000).toISOString() }), {
      status: 201,
    });
  };
  const client = createGitHubClient({
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fetchImpl,
  });

  assert.equal(await client.getInstallationToken(42n), 'installation-token');
  await client.fetchPullRequest(42n, 'owner', 'repo', 7);
  assert.equal(await client.getInstallationToken(42n), 'installation-token');

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/app\/installations\/42\/access_tokens$/);
  assert.match(requests[0].authorization ?? '', /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.equal(requests[0].userAgent, 'MergeWise');
  assert.equal(requests[1].url, 'https://api.github.com/repos/owner/repo/pulls/7');
  assert.equal(requests[1].authorization, 'Bearer installation-token');
});

test('maps GitHub PR file filenames to internal diff paths', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fetchImpl: typeof fetch = async (input) => {
    const url = input.toString();
    if (url.endsWith('/app/installations/42/access_tokens')) {
      return new Response(JSON.stringify({ token: 'installation-token' }), { status: 201 });
    }
    if (url.endsWith('/pulls/7')) {
      return new Response(JSON.stringify({ head: { sha: 'head-sha' } }));
    }
    if (url.endsWith('/pulls/7/files?per_page=100')) {
      return new Response(JSON.stringify([{
        filename: 'docs/fixture.js',
        patch: '@@ -1 +1,2 @@\n+fixture',
        additions: 1,
        deletions: 0,
      }]));
    }
    return new Response(null, { status: 404 });
  };
  const client = createGitHubClient({
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fetchImpl,
  });

  const { files } = await client.fetchDiffFiles(42n, 'owner', 'repo', 7);

  assert.equal(files[0].path, 'docs/fixture.js');
});

test('finds a MergeWise review published for the exact PR head', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fetchImpl: typeof fetch = async (input) => {
    const url = input.toString();
    if (url.endsWith('/app/installations/42/access_tokens')) {
      return new Response(JSON.stringify({ token: 'installation-token' }), { status: 201 });
    }
    if (url.endsWith('/pulls/7/reviews?per_page=100')) {
      return new Response(JSON.stringify([
        { id: 1, commit_id: 'old-head', body: '## MergeWise Review' },
        { id: 2, commit_id: 'head-sha', body: 'A human review' },
        { id: 3, commit_id: 'head-sha', body: '## MergeWise Review' },
      ]));
    }
    return new Response(null, { status: 404 });
  };
  const client = createGitHubClient({
    appId: '123',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fetchImpl,
  });

  assert.equal(await client.findPublishedReviewId(42n, 'owner', 'repo', 7, 'head-sha'), 3n);
  assert.equal(await client.findPublishedReviewId(42n, 'owner', 'repo', 7, 'missing-sha'), null);
});
