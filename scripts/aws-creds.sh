#!/usr/bin/env bash
# Exports your current AWS credentials (SSO / `aws login` / profile) to .demo/aws/credentials.json so the
# carpip-intelligence container can call Amazon Bedrock. The container hot-reloads the file when it changes.
# Temporary credentials expire (often only ~15 min with `aws login`): run `scripts/aws-creds.sh --loop` to refresh every 4 minutes.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .demo/aws
refresh() {
  aws configure export-credentials --format process ${AWS_PROFILE:+--profile "$AWS_PROFILE"} > .demo/aws/credentials.json.tmp
  mv .demo/aws/credentials.json.tmp .demo/aws/credentials.json
  echo "[$(date +%H:%M:%S)] AWS credentials exported -> .demo/aws/credentials.json (expires: $(python -I -c "import json;print(json.load(open('.demo/aws/credentials.json')).get('Expiration','n/a'))"))"
}
refresh
if [[ "${1:-}" == "--loop" ]]; then
  while true; do sleep 240; refresh || echo "refresh failed - run 'aws login' again"; done
fi
