/** Recorded runs served through the store: no network call, same results as the cached live run, gaps marked. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { QlooClient } from "@/lib/qloo";
import { liveDeps, runCheckWith, runSampleCheck } from "@/lib/check";
import { StubProvider, runAgent } from "@/lib/agent";
import { DREAM_HACKERS, PENNYWELL } from "@/lib/demo";
import { kv } from "@/lib/kv";
import { MemoryStore, setStoreForTests } from "@/lib/store";
import { loadSamples, resetSamplesForTests, sampleDeps, sampleFor } from "@/lib/samples";
import { tagLookTool } from "@/lib/tools";
import { recordedStamp } from "@/lib/stamp";
import type { CheckResult } from "@/lib/types";
import { syntheticRecording } from "./fixtures/synthetic";

const cached = existsSync(path.resolve(__dirname, "../.cache"));
const view = (r: CheckResult) => ({
  verdict: r.verdictLines,
  rows: r.comps.map((c) => ({ t: c.match.input.title, badge: c.match.badge, m: c.match.matchedTitle, y: c.match.matchedYear, dir: c.match.directorInRecord, deck: c.match.directorFromDeck, fit: c.fit?.affinity?.toFixed(6), status: c.fit?.status, rank: c.rank, f: c.skew?.female?.toFixed(6), a: c.skew?.age?.toFixed(6), views: c.views?.views, why: c.reasonsExport, aud: c.audienceExport, flags: [c.considerCutting, c.cutLabel, !!c.skewFlag, c.skewSplit] })),
  mean: [r.deckMean?.female.toFixed(6), r.deckMean?.age.toFixed(6)],
});

async function seedSynthetic() {
  const db = kv();
  await db.putSample(syntheticRecording("pennywell", "Pennywell", PENNYWELL));
  await db.putSample(syntheticRecording("dreamhackers", "Dream Hackers", DREAM_HACKERS));
}

describe("recorded samples (synthetic, through the store)", () => {
  beforeEach(async () => { setStoreForTests(new MemoryStore()); resetSamplesForTests(); await seedSynthetic(); });
  afterEach(() => { vi.restoreAllMocks(); setStoreForTests(undefined); resetSamplesForTests(); });
  for (const [id, deck] of [["pennywell", PENNYWELL], ["dreamhackers", DREAM_HACKERS]] as const) {
    it(`${id}: a recorded run makes no network call and finishes`, async () => {
      const spy = vi.spyOn(globalThis, "fetch");
      const fx = (await sampleFor(deck))!;
      expect(fx.id).toBe(id);
      const r = await runSampleCheck(fx, deck, { provider: new StubProvider() });
      expect(spy).not.toHaveBeenCalled();
      expect(r.qlooCalls).toBe(0);
      expect(r.comps.every((c) => c.match.badge === "Matched" && c.fit?.status === "Scored" && typeof c.skew?.age === "number")).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/recordedTagLooks/);
      expect(recordedStamp(r)).toMatch(/^Qloo results recorded Oct 9, 2026 · Fixed rules chose \d+ of \d+ steps live$/);
    });
  }
  it("with no store data there are no samples (and so no landing snippet)", async () => {
    setStoreForTests(new MemoryStore()); resetSamplesForTests();
    expect((await loadSamples()).samples).toEqual([]);
    expect(await sampleFor(PENNYWELL)).toBeUndefined();
    expect(await kv().landing()).toBeUndefined();
  });
  it("Remove reaches a recorded make-up; tag looks not recorded for it are gaps, not offered, and marked", async () => {
    const less = PENNYWELL.filter((c) => c.title !== "Midsommar");
    const fx = (await sampleFor(less))!;
    expect(fx).toBeDefined();
    expect(await sampleFor([...PENNYWELL.slice(0, 5), { title: "Us", year: 2019 }])).toBeUndefined();
    const run = await runAgent(less, sampleDeps(fx), new StubProvider());
    const { choiceView } = await import("@/lib/agent");
    expect(choiceView(run.state, [], 3).tools).not.toContain("look_at_tags");
    const r = await runSampleCheck(fx, less, { provider: new StubProvider() });
    for (const c of less) expect(r.notes).toContain(`Not recorded: ${c.title} tags`);
  });
});

describe.skipIf(!cached)("recorded samples equal the cached live run (local Qloo cache only)", () => {
  beforeEach(async () => {
    setStoreForTests(new MemoryStore()); resetSamplesForTests();
    const { buildSampleRecordings } = await import("../scripts/lib/build-samples");
    const saved = process.env.QLOO_API_KEY;
    const { recordings } = await buildSampleRecordings();
    if (saved) process.env.QLOO_API_KEY = saved;
    for (const r of recordings) await kv().putSample(r);
  });
  afterEach(() => { setStoreForTests(undefined); resetSamplesForTests(); });
  for (const [id, deck] of [["pennywell", PENNYWELL], ["dreamhackers", DREAM_HACKERS]] as const) {
    it(`${id}: verdict, rows, Why, audience, pageviews to 6 decimals; tag looks equal`, async () => {
      const saved = process.env.QLOO_API_KEY; delete process.env.QLOO_API_KEY; // cache only
      try {
        const q = new QlooClient();
        const live = await runCheckWith(deck, liveDeps(q, false), q.stats, { provider: new StubProvider() });
        expect(q.stats.calls).toBe(0);
        const fx = (await sampleFor(deck))!;
        const rec = await runCheckWith(deck, sampleDeps(fx), { calls: 0, cacheHits: 0 }, { provider: new StubProvider() });
        expect(view(rec)).toEqual(view(live));
        const a = await runAgent(deck, liveDeps(new QlooClient(), false), new StubProvider());
        const b = await runAgent(deck, sampleDeps(fx), new StubProvider());
        for (const c of a.state.comps) expect(tagLookTool(b.state, c.key)).toEqual(tagLookTool(a.state, c.key));
      } finally { if (saved) process.env.QLOO_API_KEY = saved; }
    });
  }
  it("stored samples hold no Qloo IDs or response fields", async () => {
    const raw = JSON.stringify(await loadSamples());
    expect(raw).not.toMatch(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i);
    expect(raw).not.toMatch(/entity_id|tag_id|"properties"|"query"|urn:|recordTags/);
  });
});
