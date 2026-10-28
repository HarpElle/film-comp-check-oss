/**
 * Seed files for test servers that use the in-memory store (MEMORY_STORE_SEED; off Vercel only): synthetic
 * samples (no Qloo data) plus a quota reading, and the same recordings as JSON for the mocked Qloo
 * (e2e/mock-qloo.mjs). Writes <SEED_OUT>/{recordings,high,low,none}.json.
 *   high: quota well above the floor (button and the second live run)
 *   low:  just above the reserve (button, but no second run)
 *   none: no quota reading this month (no button; the quiet line)
 * Run: SEED_OUT=/tmp/x npx vitest run --config scripts/vitest.scripts.config.ts scripts/seed-memory.ts
 */
import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { kv } from "@/lib/kv";
import { MemoryStore } from "@/lib/store";
import { DREAM_HACKERS, PENNYWELL } from "@/lib/demo";
import { RESERVE } from "@/lib/pacing";
import { sampleGate } from "@/lib/live-sample";
import { syntheticRecording } from "../test/fixtures/synthetic";
import { seed } from "./lib/seed";

it("writes in-memory store seeds", async () => {
  const out = process.env.SEED_OUT;
  expect(out, "set SEED_OUT").toBeTruthy();
  const recs = [syntheticRecording("pennywell", "Pennywell", PENNYWELL), syntheticRecording("dreamhackers", "Dream Hackers", DREAM_HACKERS)];
  writeFileSync(path.join(out!, "recordings.json"), JSON.stringify(recs));
  // The test servers run on SAMPLE_CLOCK (set by e2e/run-live-sample.sh): after the 1-a-day cap, with the slice accrued from Oct 20.
  const now = process.env.SAMPLE_CLOCK ? new Date(process.env.SAMPLE_CLOCK) : new Date();
  const firstDay = "2026-10-20";
  for (const [name, remaining] of [["high", 200_000], ["low", RESERVE + 30], ["none", undefined]] as const) {
    const store = new MemoryStore();
    const db = kv(store);
    await seed(db, recs);
    if (remaining !== undefined) { await db.putQuota(remaining, now.toISOString()); await db.putSampleFirstDay(firstDay); }
    const g = sampleGate({ liveOn: true, quota: remaining === undefined ? undefined : { remaining, at: now.toISOString() }, sliceUsed: 0, comps: PENNYWELL.length, now, firstDay });
    expect(g.first).toBe(name !== "none");
    expect(g.second).toBe(name === "high");
    writeFileSync(path.join(out!, `${name}.json`), JSON.stringify(store.dump()));
  }
  console.log(`seeds written to ${out}`);
});
