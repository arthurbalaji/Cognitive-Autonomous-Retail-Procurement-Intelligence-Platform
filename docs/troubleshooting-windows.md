# Troubleshooting (Windows 11 + Docker Desktop)

| Symptom | Cause | Fix |
|---|---|---|
| Containers killed / `exit 137`, builds hang | WSL2 memory too small | Copy `infra/docker/wslconfig.example` to `%UserProfile%\.wslconfig`, `wsl --shutdown`, restart Docker Desktop. Stack needs ~3 GB at rest, 5-6 GB while building/training. |
| Amber "RULE-ONLY MODE" banner, engine log `auth: security token ... expired` | `aws login` credentials last ~15 min | `bash scripts/aws-creds.sh --loop` in a spare terminal. The engine hot-reloads the file; no restart. Admin -> System health -> *Test now* shows the exact cause. |
| `no_credentials` | `.demo/aws/credentials.json` missing | Run `aws login`, then `bash scripts/aws-creds.sh`. |
| `model_not_found` / 404 | Model not enabled in the region | Enable Claude Sonnet 5.5 for your account in Bedrock (us-east-1) or set `AWS_REGION` / `BEDROCK_MODEL_ID` in `.env`. |
| Port already allocated | Another program uses 3000/4000/5050/5432/6379/8000/8080 | `scripts/preflight.sh` lists them. Stop the program or change the *left* side of the port mapping in `docker-compose.yml`. Windows may reserve ranges (`netsh interface ipv4 show excludedportrange protocol=tcp`; fix with `net stop winnat && net start winnat`). |
| `bad interpreter` / `\r: command not found` in a container script | CRLF line endings | `git config core.autocrlf false`, re-checkout. `.gitattributes` forces LF for `*.sh`. |
| Webhooks suddenly return 401 `timestamp_out_of_tolerance`, JWT "expired" right after login | Container clock drifted after laptop sleep | `wsl --shutdown`, restart Docker Desktop. `preflight.sh` reports skew. |
| First `docker compose up --build` takes 15-25 min | PyTorch + Maven + npm downloads | Normal once; layers are cached afterwards. `COMPOSE_PARALLEL_LIMIT=2` is set by `up.sh` to avoid memory spikes. |
| Bootstrap seems stuck at "training the forecasting ensemble" | CPU training of 3 tenants (~3-4 min on a 12-thread laptop) | `docker compose logs -f carpip-intelligence`; or `SKIP_ML=true docker compose run --rm bootstrap` and train later from Admin -> *CDIN & forecasting*. |
| `localhost` healthcheck fails in alpine | Alpine resolves `localhost` to `::1` | Healthchecks use `127.0.0.1` (already done). |
| Path contains a space (`D:\CARPIP final`) | Shell quoting | Always quote paths; compose project name is fixed (`carpip`). |
| Everything is broken after experiments | Stale volumes | `bash scripts/reset.sh && bash scripts/up.sh`. |
