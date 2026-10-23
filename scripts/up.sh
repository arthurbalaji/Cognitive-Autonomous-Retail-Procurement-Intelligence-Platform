#!/usr/bin/env bash
# One-command start: preflight -> AWS credentials -> build/start everything -> wait for provisioning.
#   bash scripts/up.sh            full start (models + federated rounds are trained during bootstrap)
#   SKIP_ML=true bash scripts/up.sh   fast start (~1 min after the first build; forecasts/CDIN empty)
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/preflight.sh
if [[ ! -f .env ]]; then
  echo "Creating .env with random secrets (demo only)..."
  gen() { openssl rand -base64 "$1" | tr -d '\n=+/' | cut -c1-"$2"; }
  sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(gen 24 24)|" -e "s|^CARPIP_DB_PASSWORD=.*|CARPIP_DB_PASSWORD=$(gen 24 24)|" \
      -e "s|^CARPIP_INTEL_DB_PASSWORD=.*|CARPIP_INTEL_DB_PASSWORD=$(gen 24 24)|" -e "s|^POS_DB_PASSWORD=.*|POS_DB_PASSWORD=$(gen 24 24)|" \
      -e "s|^ERP_DB_PASSWORD=.*|ERP_DB_PASSWORD=$(gen 24 24)|" -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" \
      -e "s|^CARPIP_ENC_KEY=.*|CARPIP_ENC_KEY=$(openssl rand -base64 32 | tr -d '\n')|" -e "s|^INTERNAL_SERVICE_TOKEN=.*|INTERNAL_SERVICE_TOKEN=$(gen 32 32)|" \
      -e "s|^POS_ADMIN_TOKEN=.*|POS_ADMIN_TOKEN=$(gen 24 24)|" -e "s|^ERP_ADMIN_TOKEN=.*|ERP_ADMIN_TOKEN=$(gen 24 24)|" .env.example > .env
fi
mkdir -p .demo/aws
if bash scripts/aws-creds.sh; then :; else echo "WARNING: could not export AWS credentials - the engine will run in RULE-ONLY mode (no LLM). Run 'aws login' and then scripts/aws-creds.sh."; fi
export COMPOSE_PARALLEL_LIMIT=2     # building JVM + torch + node images in parallel can exhaust a 16 GB laptop
docker compose up -d --build
echo
echo "Stack is starting. Provisioning (data, integrations, federated rounds, model training) runs in the 'bootstrap' container:"
echo "   docker compose logs -f bootstrap"
until [[ "$(docker inspect -f '{{.State.Status}}' carpip-bootstrap-1 2>/dev/null || echo missing)" == "exited" ]]; do sleep 5; done
docker compose logs --tail 5 bootstrap
echo
cat .demo/credentials.md 2>/dev/null | head -30 || true
echo "Tip: keep 'bash scripts/aws-creds.sh --loop' running in another terminal - aws login credentials expire in ~15 minutes."
