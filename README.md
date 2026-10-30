# MergeWise

MergeWise is a low-noise GitHub App for AI code review. It prioritizes changed files, publishes at most one inline comment and one summary per pull request, records lower-confidence findings as observations, and supports feedback-driven rule muting.

## Repository layout

- `app/`: TypeScript service, Cloudflare Worker entry point, tests, schema, and deployment configuration.
- `prototype/`: interactive product prototype and user guide.
- `docs/`: technical and prototype design documents, press release, and changelog.

## Local development

The service targets Node.js 20 or newer. From `app/`, run:

```bash
npm ci
npm test
npm run typecheck
```

Copy `app/.dev.vars.example` to `app/.dev.vars` for local secrets. Copy `app/.env.example` or `app/.env.production.example` when using the Docker deployment path. Never commit real credentials.

The Cloudflare configuration in `app/wrangler.toml` uses a placeholder D1 database ID. See `app/DEPLOY.md` for free-tier deployment setup.
