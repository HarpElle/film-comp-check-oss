/**
 * Seeds STORE_FILE_DIR with synthetic samples (no Qloo data) under the sample ids the page uses, for CI and
 * Playwright when no local Qloo cache exists. Run: npx vitest run --config scripts/vitest.scripts.config.ts scripts/seed-synthetic.ts
 */
import { it, expect } from "vitest";
import { kv } from "@/lib/kv";
import { getStore } from "@/lib/store";
import { DREAM_HACKERS, PENNYWELL } from "@/lib/demo";
import { syntheticRecording } from "../test/fixtures/synthetic";
import { seed } from "./lib/seed";

it("seeds synthetic samples", async () => {
  expect(process.env.STORE_FILE_DIR, "set STORE_FILE_DIR").toBeTruthy();
  const log = await seed(kv(getStore()), [syntheticRecording("pennywell", "Pennywell", PENNYWELL), syntheticRecording("dreamhackers", "Dream Hackers", DREAM_HACKERS)]);
  console.log(log.join("\n"));
});
