# Changelog

Dates use `YYYY-MM-DD`.

## 2026-10-28

### feat

- Added a Cloudflare Workers free deployment path with D1-backed idempotent review jobs and one-minute Cron scheduling.
- Added Web Crypto GitHub App authentication, installation token caching, Cloudflare-compatible LLM requests, webhook HMAC verification, and mute-command handling.
- Added a SQLite/D1 schema, Wrangler configuration, deployment guide, and recursive test coverage for the Cloudflare integration.
- Replaced the Oracle Cloud VM deployment guide with the Cloudflare Workers/D1/Cron deployment path.

### build

- Added an Oracle Cloud Docker Compose deployment with Caddy TLS termination, internal-only PostgreSQL, health checks, persistent volumes, production environment bootstrap, database backup script, and step-by-step deployment guide.
- Added Docker build-context exclusions so local dependencies, build output, environment files, and backups are not uploaded unnecessarily.

### fix

- Fixed Cloudflare scheduled reviews so GitHub dependencies are merged with the pinned D1 job claimer, and added regression coverage for pinned job execution.
- Fixed GitHub App JWT signing for private keys stored with escaped newline sequences.
- Added PKCS#1 GitHub App private key support for JWT signing, with signature verification coverage.
- Added the required User-Agent header to Cloudflare GitHub API requests.
- Normalized fractional LLM confidence values before schema validation and logged schema issue paths for degraded reviews.
- Enforced English finding keys in the LLM response contract and normalized common Chinese field aliases.
- Truncated overlong LLM finding titles and explanations to schema limits instead of discarding the review payload.
- Fixed Cloudflare observation persistence by generating required IDs and timestamps.
- Restored missing LLM file names by matching finding quotes against the reviewed diff.
- Mapped GitHub PR file `filename` values to MergeWise diff paths so findings retain valid file names.
- Accepted equal start and end lines as valid single-line anchors.
- Filled the required rule statistics timestamp when a rule is published for the first time.
- Persisted published review IDs before rule-stat updates so a stats failure cannot trigger duplicate GitHub reviews.
- Checked GitHub for an existing MergeWise review on the same PR head before publishing so worker retries cannot create duplicate reviews.

## 2026-10-27

### feat

- Built the MergeWise GitHub App review MVP: webhook ingestion, job queue, diff parsing, LLM analysis, line anchoring, threshold filtering, and review publication.
- Added shadow mode, one-inline-plus-one-summary noise limits, mute-command parsing, rule statistics, and automatic 30% rule muting.
- Added structured LLM retry and degraded summary behavior for invalid model output.
- Added health endpoint, production Docker image, database schema, environment template, and deployment README.

### fix

- Corrected GitHub file-patch line mapping so findings anchor to new-file line numbers.
- Corrected LLM prompt labels to use new-file line numbers while leaving deletions unnumbered.
- Corrected webhook HMAC verification in ESM and made malformed signatures fail safely.
- Corrected multi-line GitHub review comment ranges and added end-line validation.
- Made inline-comment mute replies resolve the original rule from the parent comment.
- Changed newly installed repositories to default to shadow mode.

### test

- Added Node.js test coverage for diff mapping, anchoring, worker behavior, LLM retry, signature verification, and mute rule resolution.
