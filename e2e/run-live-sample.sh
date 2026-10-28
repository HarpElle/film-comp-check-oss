#!/usr/bin/env bash
# "Run live on Qloo" on the samples, against a mocked Qloo (e2e/mock-qloo.mjs, synthetic data) and production
# servers with the in-memory store (seeded from scripts/seed-memory.ts). No real Qloo call can leave: the key
# is a placeholder, QLOO_BASE_URL points at the mock, and the raw Qloo cache is a temp dir. Needs `npm run build`.
#   3094 high quota (button, second run)   3095 low quota (button, no second run)   3096 no quota reading (quiet line)
#   3097 high quota with SAMPLE_LIVE unset (the default): no button, no quiet line, only "Run again"
set -euo pipefail
cd "$(dirname "$0")/.."
PORTS="3094 3095 3096 3097 3190"
for p in $PORTS; do if fuser "$p/tcp" >/dev/null 2>&1; then echo "port $p is busy; stop that server first" >&2; exit 1; fi; done
export SAMPLE_CLOCK=2026-11-10T18:00:00Z # test-only clock for the sample gate (see README)
T=$(mktemp -d); mkdir -p "$T/seed" "$T/rawcache"
SEED_OUT="$T/seed" npx vitest run --config scripts/vitest.scripts.config.ts scripts/seed-memory.ts >/dev/null
node e2e/mock-qloo.mjs 3190 "$T/seed/recordings.json" >"$T/mock.log" 2>&1 & PM=$!
common=(env -u ANTHROPIC_API_KEY -u QLOO_ANTHROPIC_API_KEY -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN -u KV_REST_API_URL -u KV_REST_API_TOKEN -u STORE_FILE_DIR -u QLOO_LIVE -u SAMPLE_LIVE
  QLOO_API_KEY=mock-key QLOO_BASE_URL=http://127.0.0.1:3190 QLOO_MIN_GAP_MS=20 COMP_CACHE_DIR="$T/rawcache" AGENT_PROVIDER=stub)
"${common[@]}" SAMPLE_LIVE=1 MEMORY_STORE_SEED="$T/seed/high.json" npx next start -p 3094 -H 127.0.0.1 >"$T/high.log" 2>&1 & P1=$!
"${common[@]}" SAMPLE_LIVE=1 MEMORY_STORE_SEED="$T/seed/low.json" npx next start -p 3095 -H 127.0.0.1 >"$T/low.log" 2>&1 & P2=$!
"${common[@]}" SAMPLE_LIVE=1 MEMORY_STORE_SEED="$T/seed/none.json" npx next start -p 3096 -H 127.0.0.1 >"$T/none.log" 2>&1 & P3=$!
"${common[@]}" MEMORY_STORE_SEED="$T/seed/high.json" npx next start -p 3097 -H 127.0.0.1 >"$T/off.log" 2>&1 & P4=$!
stop() { kill $PM $P1 $P2 $P3 $P4 2>/dev/null || true; for p in $PORTS; do fuser -k -TERM "$p/tcp" >/dev/null 2>&1 || true; done; rm -rf "$T"; }
trap stop EXIT
for p in 3094 3095 3096 3097; do for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$p/api/status" >/dev/null && break; sleep 1; done; done
RECORDED_AT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$T/seed/recordings.json','utf8'))[0].recordedAt)")
QA_LIVE_HIGH=http://127.0.0.1:3094 QA_LIVE_LOW=http://127.0.0.1:3095 QA_LIVE_NONE=http://127.0.0.1:3096 QA_LIVE_OFF=http://127.0.0.1:3097 QA_MOCK=http://127.0.0.1:3190 QA_RECORDED_AT="$RECORDED_AT" \
  npx playwright test e2e/live-sample.spec.ts "$@"
