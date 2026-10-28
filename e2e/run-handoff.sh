#!/usr/bin/env bash
# Runs the design acceptance specs (handoff, remove, steps, share; override with HANDOFF_SPECS) against a no-key production server on a COPY of a recorded store.
# AGENT_PROVIDER=claude with no key replays the recorded agent steps. 0 Qloo calls: Qloo, Claude and KV keys unset, QLOO_LIVE=0, an empty comp cache. Needs `npm run build` first.
# HANDOFF_STORE: a directory of recorded store files (required). It is copied, never written.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${HANDOFF_STORE:-}"
PORT="${HANDOFF_PORT:-3095}"
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "no recorded store at $SRC (set HANDOFF_STORE)" >&2; exit 1; }
if fuser "$PORT/tcp" >/dev/null 2>&1; then echo "port $PORT is busy" >&2; exit 1; fi
T=$(mktemp -d); mkdir -p "$T/store" "$T/empty-cache"; cp -r "$SRC/." "$T/store/"
env -u QLOO_API_KEY -u ANTHROPIC_API_KEY -u QLOO_ANTHROPIC_API_KEY -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN \
  -u KV_REST_API_URL -u KV_REST_API_TOKEN -u KV_URL -u REDIS_URL -u SHARED_STORE \
  STORE_FILE_DIR="$T/store" COMP_CACHE_DIR="$T/empty-cache" QLOO_LIVE=0 AGENT_PROVIDER=claude \
  npx next start -p "$PORT" -H 127.0.0.1 >"$T/server.log" 2>&1 & PID=$!
stop() { kill "$PID" 2>/dev/null || true; fuser -k -TERM "$PORT/tcp" >/dev/null 2>&1 || true; rm -rf "$T"; }
trap stop EXIT
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/status" >/dev/null && break; sleep 1; done
if [ -n "${HANDOFF_SERVE_ONLY:-}" ]; then echo "serving on http://127.0.0.1:$PORT (store copy $T/store)"; wait "$PID"; exit 0; fi
# Playwright's own webServer (playwright.config.ts) inherits this env, so it gets no keys either.
env -u QLOO_API_KEY -u ANTHROPIC_API_KEY -u QLOO_ANTHROPIC_API_KEY -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN \
  -u KV_REST_API_URL -u KV_REST_API_TOKEN -u KV_URL -u REDIS_URL -u SHARED_STORE STORE_FILE_DIR="$T/store" COMP_CACHE_DIR="$T/empty-cache" QLOO_LIVE=0 \
  QA_HANDOFF_URL="http://127.0.0.1:$PORT" QA_HANDOFF_STORE="$T/store" npx playwright test ${HANDOFF_SPECS:-e2e/handoff.spec.ts e2e/remove.spec.ts e2e/steps.spec.ts e2e/share.spec.ts e2e/draft.spec.ts e2e/errors.spec.ts e2e/demo.spec.ts e2e/stop.spec.ts e2e/tablet-input.spec.ts} "$@"
