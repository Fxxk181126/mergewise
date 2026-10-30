import { TOKEN_TTL_MS } from '../types.js';

type JsonWebKey = Record<string, string | boolean | string[]>;

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  fetchImpl?: typeof fetch;
}

export interface DiffFileResponse {
  filename?: string;
  path?: string;
  patch?: string;
  additions: number;
  deletions: number;
}

export interface PullRequestResponse {
  head: { sha: string };
}

export interface ReviewSummaryResponse {
  id: number;
  commit_id?: string;
  body?: string;
}

export interface ReviewCommentBody {
  body?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const base64 = pem
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const der = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) der[index] = binary.charCodeAt(index);
  return der;
}

function readDerLength(bytes: Uint8Array, offset: number): { length: number; next: number } {
  const first = bytes[offset];
  if (first < 0x80) return { length: first, next: offset + 1 };

  const lengthBytes = first & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 4 || offset + lengthBytes >= bytes.length) {
    throw new Error('Invalid DER length');
  }

  let length = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    length = (length << 8) | bytes[offset + 1 + index];
  }
  return { length, next: offset + 1 + lengthBytes };
}

function parseDerIntegers(sequence: Uint8Array): bigint[] {
  if (sequence[0] !== 0x30) throw new Error('Expected DER sequence');
  const sequenceLength = readDerLength(sequence, 1);
  const contentStart = sequenceLength.next;
  const end = Math.min(contentStart + sequenceLength.length, sequence.length);
  let offset = contentStart;
  const integers: bigint[] = [];

  while (offset < end) {
    if (sequence[offset] !== 0x02) throw new Error('Expected DER integer');
    const { length, next } = readDerLength(sequence, offset + 1);
    const start = next;
    integers.push(BigInt(`0x${Array.from(sequence.slice(start, start + length), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')}`));
    offset = start + length;
  }

  return integers;
}

function base64UrlBytes(value: bigint): string {
  if (value === 0n) return 'AA';

  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function pkcs1ToJwk(der: Uint8Array): JsonWebKey {
  const [version, n, e, d, p, q, dp, dq, qi] = parseDerIntegers(der);
  if (version !== 0n || [n, e, d, p, q, dp, dq, qi].some((value) => value === undefined)) {
    throw new Error('Invalid RSA private key');
  }

  return {
    kty: 'RSA',
    alg: 'RS256',
    key_ops: ['sign'],
    ext: true,
    n: base64UrlBytes(n),
    e: base64UrlBytes(e),
    d: base64UrlBytes(d),
    p: base64UrlBytes(p),
    q: base64UrlBytes(q),
    dp: base64UrlBytes(dp),
    dq: base64UrlBytes(dq),
    qi: base64UrlBytes(qi),
  };
}

async function importPrivateKey(pem: string) {
  const der = pemToDer(pem);
  if (pem.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    return crypto.subtle.importKey(
      'jwk',
      pkcs1ToJwk(der),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }

  return crypto.subtle.importKey(
    'pkcs8',
    der as unknown as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function createAppToken(config: { appId: string; privateKey: string }, now = Date.now()): Promise<string> {
  const key = await importPrivateKey(config.privateKey);
  const header = base64UrlEncode(new TextEncoder().encode('{"alg":"RS256","typ":"JWT"}'));
  const claims = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    iat: Math.floor(now / 1000) - 60,
    exp: Math.floor(now / 1000) + 600,
    iss: config.appId,
  })));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`) as unknown as ArrayBuffer,
  );
  return `${header}.${claims}.${base64UrlEncode(signature)}`;
}

export function createGitHubClient(config: GitHubAppConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const installationTokens = new Map<bigint, TokenCache>();

  async function requestJson<T>(installationId: bigint, path: string, init: RequestInit = {}): Promise<T> {
    const token = await getInstallationToken(installationId);
    const response = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'MergeWise',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw Object.assign(new Error(`GitHub API ${response.status}: ${await response.text()}`), {
        status: response.status,
      });
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  async function getInstallationToken(installationId: bigint): Promise<string> {
    const cached = installationTokens.get(installationId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const response = await fetchImpl(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'MergeWise',
          Authorization: `Bearer ${await createAppToken(config)}`,
        },
      },
    );
    if (!response.ok) throw new Error(`GitHub installation token ${response.status}: ${await response.text()}`);
    const data = await response.json() as { token: string; expires_at?: string };
    const expiresAt = data.expires_at
      ? Date.parse(data.expires_at) - 60_000
      : Date.now() + TOKEN_TTL_MS;
    installationTokens.set(installationId, { token: data.token, expiresAt });
    return data.token;
  }

  async function fetchPullRequest(installationId: bigint, owner: string, repo: string, pr: number) {
    return await requestJson<PullRequestResponse>(installationId, `/repos/${owner}/${repo}/pulls/${pr}`);
  }

  return {
    getInstallationToken,
    fetchPullRequest,

    async getCurrentHeadSha(installationId: bigint, owner: string, repo: string, pr: number): Promise<string> {
      const prData = await requestJson<PullRequestResponse>(installationId, `/repos/${owner}/${repo}/pulls/${pr}`);
      return prData.head.sha;
    },

    async fetchDiffFiles(installationId: bigint, owner: string, repo: string, pr: number) {
      const [prData, files] = await Promise.all([
        fetchPullRequest(installationId, owner, repo, pr),
        requestJson<DiffFileResponse[]>(installationId, `/repos/${owner}/${repo}/pulls/${pr}/files?per_page=100`),
      ]);
      return {
        headSha: prData.head.sha,
        files: files.map((file) => ({
          path: file.filename ?? file.path ?? '',
          patch: file.patch ?? '',
          additions: file.additions,
          deletions: file.deletions,
        })),
      };
    },

    async getReviewCommentBody(installationId: bigint, owner: string, repo: string, commentId: number) {
      const comment = await requestJson<ReviewCommentBody>(
        installationId,
        `/repos/${owner}/${repo}/pulls/comments/${commentId}`,
      );
      return comment.body ?? null;
    },

    async createReview(
      installationId: bigint,
      owner: string,
      repo: string,
      pr: number,
      headSha: string,
      body: string,
      comments: { path: string; line: number; side?: string; start_line?: number; body: string }[],
    ): Promise<bigint> {
      const review = await requestJson<{ id: number }>(installationId, `/repos/${owner}/${repo}/pulls/${pr}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit_id: headSha, event: 'COMMENT', body, comments }),
      });
      return BigInt(review.id);
    },

    async findPublishedReviewId(
      installationId: bigint,
      owner: string,
      repo: string,
      pr: number,
      headSha: string,
    ): Promise<bigint | null> {
      const reviews = await requestJson<ReviewSummaryResponse[]>(
        installationId,
        `/repos/${owner}/${repo}/pulls/${pr}/reviews?per_page=100`,
      );
      const review = reviews.find((candidate) =>
        candidate.commit_id === headSha &&
        candidate.body?.startsWith('## MergeWise Review')
      );
      return review ? BigInt(review.id) : null;
    },

    async createSummaryOnlyReview(
      installationId: bigint,
      owner: string,
      repo: string,
      pr: number,
      headSha: string,
      body: string,
    ): Promise<bigint> {
      const review = await requestJson<{ id: number }>(installationId, `/repos/${owner}/${repo}/pulls/${pr}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit_id: headSha, event: 'COMMENT', body }),
      });
      return BigInt(review.id);
    },
  };
}
