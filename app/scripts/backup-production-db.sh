#!/usr/bin/env bash

set -euo pipefail

output="${1:-mergewise-$(date +%F).sql}"

docker compose exec -T db pg_dump -U mergewise mergewise > "$output"
chmod 600 "$output"
echo "Database backup written to $output"
