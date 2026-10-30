#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <public-domain>" >&2
  exit 2
fi

domain="$1"
env_file="$(dirname "$0")/../.env"

if [[ -e "$env_file" ]]; then
  echo "Refusing to overwrite existing $env_file" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate local secrets" >&2
  exit 1
fi

umask 077

cat > "$env_file" <<EOF
DOMAIN=${domain}
POSTGRES_PASSWORD=$(openssl rand -hex 24)
WEBHOOK_SECRET=$(openssl rand -hex 32)
GITHUB_APP_ID=replace-with-github-app-id
GITHUB_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nreplace-with-github-app-private-key\\n-----END PRIVATE KEY-----"
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=replace-with-llm-api-key
LLM_MODEL=deepseek-chat
DEFAULT_THRESHOLD=80
EOF

chmod 600 "$env_file"
echo "Created $env_file with generated database and webhook secrets."
