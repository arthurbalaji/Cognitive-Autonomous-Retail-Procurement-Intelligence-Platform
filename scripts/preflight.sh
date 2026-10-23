#!/usr/bin/env bash
# Catches the usual Windows / laptop problems before they turn into confusing container errors.
cd "$(dirname "$0")/.."
ok=1
warn() { echo "  ! $*"; ok=0; }
echo "Preflight checks"
command -v docker >/dev/null || { warn "docker not found"; exit 1; }
docker info >/dev/null 2>&1 || { warn "Docker daemon is not running - start Docker Desktop"; exit 1; }
mem=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
if [[ "$mem" -gt 0 && "$mem" -lt 6500000000 ]]; then warn "Docker has only $((mem / 1048576)) MB. Give it >= 8 GB (see infra/docker/wslconfig.example, then 'wsl --shutdown')."; fi
for p in 3000 3100 3200 4000 5050 5432 6379 8000 8080 9094; do
  if (echo >"/dev/tcp/127.0.0.1/$p") >/dev/null 2>&1; then
    owner=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -c ":$p->" || true)
    [[ "$owner" -eq 0 ]] && warn "port $p is already in use by another program (stop it, or change the published port in docker-compose.yml)"
  fi
done
if grep -rlI $'\r' --include=*.sh scripts infra 2>/dev/null | head -1 | grep -q .; then warn "shell scripts contain CRLF line endings (breaks in containers). Run: git config core.autocrlf false && git checkout -- ."; fi
host=$(date -u +%s); cont=$(docker run --rm alpine date -u +%s 2>/dev/null || echo "$host")
skew=$(( host > cont ? host - cont : cont - host ))
[[ "$skew" -gt 120 ]] && warn "container clock differs from host by ${skew}s (WSL drift after sleep) - HMAC/JWT checks would fail. Run 'wsl --shutdown' and restart Docker Desktop."
command -v aws >/dev/null || warn "AWS CLI not found - needed by scripts/aws-creds.sh for Bedrock access (engine falls back to RULE-ONLY mode without it)"
[[ $ok -eq 1 ]] && echo "  all good" || echo "  (warnings above - continuing anyway)"
exit 0
