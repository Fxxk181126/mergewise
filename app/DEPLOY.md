# Cloudflare free deployment

MergeWise runs as one Cloudflare Worker. The `/webhook` request verifies GitHub's HMAC signature, upserts repository state, and inserts an idempotent review job into D1. A one-minute Cron Trigger claims up to three jobs per run and invokes the existing review pipeline. This uses the Workers, D1, and Cron free allowances and avoids Cloudflare Queues, VMs, tunnels, and public database ports.

The endpoint is the Worker's own HTTPS URL, for example:

```text
https://mergewise.<your-subdomain>.workers.dev/webhook
```

## 1. Prepare

- A Cloudflare account with Workers and D1 enabled.
- Node.js 22.
- A GitHub App private key and a DeepSeek-compatible API key.

From the project directory:

```bash
npm ci
npx wrangler login
```

## 2. Create D1

```bash
npx wrangler d1 create mergewise
```

Copy the printed `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mergewise"
database_id = "the-id-from-create-command"
```

Initialize the remote database:

```bash
npx wrangler d1 execute mergewise --remote --file schema.d1.sql
```

## 3. Configure the GitHub App

Set the app permissions and events:

- Repository permissions: Pull requests **Read and write**, Contents **Read-only**, Metadata **Read-only**.
- Subscribe to `pull_request`, `issue_comment`, and `pull_request_review_comment`.
- Webhook URL: `https://mergewise.<your-subdomain>.workers.dev/webhook`.

Generate a webhook secret and keep it for the next section. GitHub's initial ping must receive HTTP `200` after deployment.

## 4. Set Wrangler secrets

Run each command and paste the value when prompted:

```bash
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_PRIVATE_KEY
npx wrangler secret put LLM_API_KEY
```

For `GITHUB_PRIVATE_KEY`, paste the complete PEM including both delimiter lines, then press `Ctrl-D`. Keep newline characters intact. `LLM_BASE_URL`, `LLM_MODEL`, and `DEFAULT_THRESHOLD` are non-secret defaults in `wrangler.toml`; edit them only if your API differs.

For local development, copy `.dev.vars.example` to `.dev.vars`, fill in the same values, and never commit it.

## 5. Deploy and verify

```bash
npm run typecheck
npm test
npm run deploy
```

Copy the Worker URL from the Wrangler output, then check health:

```bash
curl -fsS https://mergewise.<your-subdomain>.workers.dev/health
```

The response must contain `"status":"ok"` before you enable the GitHub webhook or install the GitHub App.

## 6. Enable reviews

Install the GitHub App on repositories you want reviewed. New repositories start in `shadow` mode, so findings are recorded but not published.

After inspecting observations, switch one repository deliberately:

```bash
npx wrangler d1 execute mergewise --remote --command \
  "UPDATE repos SET mode = 'commenting' WHERE full_name = 'owner/repo'"
```

Set the mode back to `shadow` whenever you want to stop publishing.

## Operations

Tail production logs:

```bash
npx wrangler tail
```

Inspect recent queue rows:

```bash
npx wrangler d1 execute mergewise --remote --command \
  "SELECT status, count(*) FROM reviews GROUP BY status"
```

Redeployment is `npm run deploy`. To stop work temporarily, remove `[triggers]` from `wrangler.toml`, deploy once, and keep the Worker URL; or suspend the GitHub App integration.

## Free-tier notes

- One Cron Trigger runs once per minute and processes at most three jobs, limiting API and LLM bursts.
- Workers free requests, D1 rows read/written, and D1 storage are consumed by webhook volume, review queries, observations, and statistics.
- Worker CPU limits exclude time waiting on GitHub and the LLM, but large model responses still consume parsing time; the pipeline caps analysis at ten prioritized files.
- `.workers.dev` already provides HTTPS. A custom domain is optional and can be added later from the Cloudflare Worker settings.

These deployment steps have not been run against a production Cloudflare account in this change. Local tests verify webhook ingestion, HMAC verification, D1 row mapping, LLM request formatting, and GitHub App authentication.
