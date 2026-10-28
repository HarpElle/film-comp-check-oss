/**
 * Writes qa/expected.json (gitignored) from the local Qloo cache: the values the real-deck Playwright tests
 * compare against. Committed tests hold no Qloo-derived literals; without this file they check structure
 * and rules only. Cache only: the key is removed, so a miss fails before any request.
 * Run: npx vitest run --config scripts/vitest.scripts.config.ts scripts/expected-from-cache.test.ts
 */
import { it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runCheck } from "@/lib/check";
import { StubProvider } from "@/lib/agent";
import { PENNYWELL } from "@/lib/demo";
import type { CheckResult, CompInput } from "@/lib/types";

const DREAM: CompInput[] = [
  { title: "Blade Runner", year: 1982, director: "Ridley Scott" }, { title: "Ex Machina", year: 2014, director: "Alex Garland" },
  { title: "Her", year: 2013, director: "Spike Jonze" }, { title: "Minority Report", year: 2002, director: "Steven Spielberg" }, { title: "I, Robot", year: 2004, director: "Alex Proyas" },
];
function shape(r: CheckResult) {
  const t = (c: CheckResult["comps"][number]) => c.match.input.title;
  return {
    verdictLines: r.verdictLines,
    resolveSummary: r.matchSummary,
    scores6: Object.fromEntries(r.comps.map((c) => [t(c), c.fit?.affinity?.toFixed(6)])),
    rows: Object.fromEntries(r.comps.map((c) => [t(c), {
      score3: c.fit?.affinity?.toFixed(3),
      rank: c.rank ? `${c.rank.rank} of ${c.rank.of} \u00b7 ${typeof c.rank.gapToNext === "number" ? `${c.rank.gapToNext.toFixed(3)} below next` : "top fit"}` : undefined,
      director: c.match.directorInRecord ? `Dir. ${c.match.directorInRecord}` : undefined,
      largerGap: c.audienceExport?.largerGap,
    }])),
    outliers: r.comps.filter((c) => c.skewFlag).map(t),
    splits: r.comps.filter((c) => c.skewSplit).map(t),
    lowest: r.comps.filter((c) => c.considerCutting).map((c) => ({ title: t(c), label: c.cutLabel })),
    outlierAgeBar: r.comps.filter((c) => c.skewFlag).map((c) => `${c.skewFlag!.dAge >= 0 ? "+" : "\u2212"}${Math.abs(c.skewFlag!.dAge).toFixed(3)}`)[0],
    stopChoice: r.steps?.find((s) => s.origin === "stub" && s.action === "stop")?.choice,
    deckLean: r.deckMean ? (r.deckMean.age < 0 ? "young" : "older") : undefined,
  };
}
it("writes qa/expected.json from the cache", async () => {
  delete process.env.QLOO_API_KEY;
  const pw = await runCheck(PENNYWELL, { provider: new StubProvider() });
  const pwRemoved = await runCheck(PENNYWELL.filter((c) => c.title !== "Midsommar"), { provider: new StubProvider() });
  const dh = await runCheck(DREAM, { provider: new StubProvider() });
  for (const r of [pw, pwRemoved, dh]) expect(r.qlooCalls).toBe(0);
  const out = { note: "Generated from the local Qloo cache; gitignored; never commit.", pennywell: shape(pw), pennywellWithoutMidsommar: shape(pwRemoved), dreamhackers: shape(dh) };
  await fs.mkdir(path.resolve(__dirname, "../qa"), { recursive: true });
  await fs.writeFile(path.resolve(__dirname, "../qa/expected.json"), JSON.stringify(out, null, 1) + "\n");
});
