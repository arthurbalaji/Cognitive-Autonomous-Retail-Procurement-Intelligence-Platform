#!/usr/bin/env bash
# Wipes ALL demo state (databases, Kafka log, trained models) and stops the stack.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --profile cdin --profile tools down -v
rm -f .demo/credentials.md
echo "State wiped. Start again with: bash scripts/up.sh"
