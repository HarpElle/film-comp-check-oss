/**
 * Seeds the configured store with the recorded samples, built from the local Qloo cache (never live: the
 * Qloo key is removed first). Writes go through lib/kv.ts, so they are trimmed and sample: keys get no expiry.
 * Store: Upstash when UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN are set (UPSTASH_* first; the read-only
 * token is never used), else STORE_FILE_DIR (default .data/store, gitignored).
 * A model replay is added when .data/recorded/pennywell.claude-replay.json exists (scripts/build-claude-replay.ts).
 * Run: [SHARED_STORE=1 to target Upstash] npx vitest run --config scripts/vitest.scripts.config.ts scripts/seed-store.ts
 * Not run against Upstash until the database exists.
 */
import { it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { kv } from "@/lib/kv";
import { getStore, upstashEnv } from "@/lib/store";
import { buildSampleRecordings } from "./lib/build-samples";
import { seed } from "./lib/seed";

it("seeds the store from the local Qloo cache", async () => {
  if (!upstashEnv()) process.env.STORE_FILE_DIR ??= path.resolve(__dirname, "../.data/store");
  const store = getStore();
  const { recordings, report } = await buildSampleRecordings();
  const rp = path.resolve(__dirname, "../.data/recorded/pennywell.claude-replay.json");
  const log = await seed(kv(store), recordings, { replay: existsSync(rp) ? JSON.parse(readFileSync(rp, "utf8")) : undefined });
  console.log([`store: ${store.kind}${store.kind === "upstash" ? ` (${(store as import("@/lib/store").UpstashStore).source}_*)` : ""}${store.kind === "file" && process.env.STORE_FILE_DIR ? ` (${process.env.STORE_FILE_DIR})` : ""}`, ...report, ...log].join("\n"));
  expect(recordings.length).toBeGreaterThan(0);
}, 120_000);
