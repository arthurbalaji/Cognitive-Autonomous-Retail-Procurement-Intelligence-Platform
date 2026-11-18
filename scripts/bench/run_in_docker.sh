#!/usr/bin/env bash
# Run a paper-experiment script inside the engine image (same Python 3.11 / torch 2.4.1 CPU / xgboost 2.1.1 as production).
#   bash scripts/bench/run_in_docker.sh /work/scripts/bench/forecast_eval.py --seeds 10
# Mounts: scripts -> /work/scripts (ro), docs/results -> /out (results), .demo/bench -> /cache (large intermediates, git-ignored)
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .demo/bench docs/results
WIN="$(pwd -W 2>/dev/null || pwd)"
MSYS_NO_PATHCONV=1 docker run --rm --cpus "${BENCH_CPUS:-6}" \
  -e PYTHONPATH=/srv:/work -e PYTHONHASHSEED=0 -e TORCH_NUM_THREADS="${TORCH_THREADS:-4}" -e SEED=42 \
  -e BENCH_OUT=/out -e BENCH_CACHE=/cache \
  -v "$WIN/scripts:/work/scripts:ro" -v "$WIN/docs/results:/out" -v "$WIN/.demo/bench:/cache" \
  -w /srv carpip-ml:latest python "$@"
