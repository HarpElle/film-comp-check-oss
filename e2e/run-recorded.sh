#!/usr/bin/env bash
# Seeds a temporary store and runs e2e/recorded.spec.ts against three production servers (see the spec header).
# Seeds from the local Qloo cache when there is one (gitignored), else synthetic samples. Needs `npm run build` first.
set -euo pipefail
cd "$(dirname "$0")/.."
for p in 3091 3092 3093 3094; do if fuser "$p/tcp" >/dev/null 2>&1; then echo "port $p is busy; stop that server first" >&2; exit 1; fi; done
T=$(mktemp -d); export STORE_FILE_DIR="$T/store"; mkdir -p "$T/empty-cache"
safe=(env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN -u KV_REST_API_URL -u KV_REST_API_TOKEN -u SHARED_STORE)  # never the shared store
if [ -d .cache ] && [ "${SEED:-}" != synthetic ]; then "${safe[@]}" npx vitest run --config scripts/vitest.scripts.config.ts scripts/seed-store.ts >/dev/null; else "${safe[@]}" npx vitest run --config scripts/vitest.scripts.config.ts scripts/seed-synthetic.ts >/dev/null; fi
common=(env -u QLOO_API_KEY -u ANTHROPIC_API_KEY -u QLOO_ANTHROPIC_API_KEY -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN -u KV_REST_API_URL -u KV_REST_API_TOKEN -u KV_URL -u REDIS_URL STORE_FILE_DIR="$STORE_FILE_DIR" COMP_CACHE_DIR="$T/empty-cache")
"${common[@]}" QLOO_LIVE=0 AGENT_PROVIDER=stub npx next start -p 3091 -H 127.0.0.1 >"$T/rec.log" 2>&1 & P1=$!
"${common[@]}" IP_DAILY_LIVE_CHECKS=0 AGENT_PROVIDER=stub npx next start -p 3092 -H 127.0.0.1 >"$T/limit.log" 2>&1 & P2=$!
"${common[@]}" QLOO_LIVE=0 AGENT_PROVIDER=claude npx next start -p 3093 -H 127.0.0.1 >"$T/replay.log" 2>&1 & P3=$!
"${common[@]}" QLOO_LIVE=0 VERCEL=1 npx next start -p 3094 -H 127.0.0.1 >"$T/vercel.log" 2>&1 & P4=$!
stop() { kill $P1 $P2 $P3 $P4 2>/dev/null || true; for p in 3091 3092 3093 3094; do fuser -k -TERM "$p/tcp" >/dev/null 2>&1 || true; done; rm -rf "$T"; }
trap stop EXIT
for p in 3091 3092 3093 3094; do for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$p/api/status" >/dev/null && break; sleep 1; done; done
REPLAY_URL=""; if node -e "const fs=require('fs'),p=require('path'),c=require('crypto');const f=p.join(process.env.STORE_FILE_DIR,c.createHash('sha256').update('sample:replay:pennywell').digest('hex')+'.json');process.exit(fs.existsSync(f)?0:1)"; then REPLAY_URL="http://127.0.0.1:3093"; fi
QA_RECORDED_URL=http://127.0.0.1:3091 QA_LIMIT_URL=http://127.0.0.1:3092 QA_REPLAY_URL="$REPLAY_URL" QA_VERCEL_URL=http://127.0.0.1:3094 npx playwright test e2e/recorded.spec.ts "$@"
