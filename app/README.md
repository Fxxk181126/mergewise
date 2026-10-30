# MergeWise service

GitHub App webhook service for low-noise PR review. A webhook enqueues a review, an in-process worker analyzes up to ten prioritized files, and at most one inline comment plus one summary review are published.

## Stack

- Node.js 20, TypeScript, Hono
- Cloudflare D1 for repository state and the idempotent review queue
- Cloudflare Cron Triggers for the scheduled review worker
- GitHub App authentication through Web Crypto
- DeepSeek-compatible OpenAI chat API

## Local commands

```bash
npm ci
npm test
npm run typecheck
npx wrangler d1 execute mergewise --local --file schema.d1.sql
npx wrangler dev
```

Copy `.dev.vars.example` to `.dev.vars` and fill in local secrets. Never commit `.dev.vars`.

## GitHub App setup

- Permissions: Pull requests read/write, Contents read-only, Metadata read-only, Issues read-only.
- Webhook events: `pull_request` (`opened`, `synchronize`), `issue_comment` (`created`), and `pull_request_review_comment` (`created`).
- Point the webhook to `https://<host>/webhook`.

New repositories start in `shadow` mode and record eligible findings without publishing. Switch one repository deliberately with:

```sql
UPDATE repos SET mode = 'commenting' WHERE full_name = 'owner/repo';
```

## Noise controls

- Confidence threshold defaults to 80 and is stored per repository.
- At most one inline comment is selected by severity (`security` > `bug` > `test`).
- All other eligible findings go into one summary review.
- Below-threshold and invalid-anchor findings are stored as observations.
- `@mergewise mute this` works on explicit commands and inline-comment replies; rules with a false-positive rate above 30% are muted automatically.
- If structured LLM output fails twice, the service publishes one degraded summary instead of speculative inline comments.

## Deployment

The free deployment target is a single Cloudflare Worker. GitHub webhooks write jobs to D1, and a one-minute Cron Trigger runs up to three queued reviews. No VM, tunnel, public database, or paid Cloudflare Queue is required.

See `DEPLOY.md` for the complete free-tier setup. Keep private keys and API tokens in Wrangler secrets or `.dev.vars`; never put them in source files.
