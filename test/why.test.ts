import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent";
import { atScreen, toCheckResult } from "@/lib/check";
import { deterministicReasons } from "@/lib/reasons";
import { guardStructured } from "@/lib/claims";
import { sourcesFromState, compLabel } from "@/lib/sources";
import { toCsv, toMarkdown } from "@/lib/export";
import { SKEW_THRESHOLD } from "@/lib/skew";
import type { ToolDeps } from "@/lib/tools";
import type { QlooEntity } from "@/lib/qloo";
import type { CompInput } from "@/lib/types";

// Invented data, picked so that no value matches a recorded Qloo value at 3 decimals: D skews older (age is its larger deviation), E skews by gender. k = 2, a split.
const rec = (name: string, id: string): QlooEntity => ({ name, entity_id: id, properties: { release_year: "2010", description: name }, popularity: 0.5, tags: [] });
const IDS = ["A", "B", "C", "D", "E"];
const AFF: Record<string, number> = { A: 0.8954321, B: 0.8774321, C: 0.9224321, D: 0.8644321, E: 0.8504321 };
const FEM: Record<string, number> = { A: 0.307, B: 0.307, C: 0.307, D: 0.307, E: -0.571 };
const OLD: Record<string, number> = { A: 0, B: 0, C: 0, D: 1.476, E: 0 };
const deps: ToolDeps = {
  search: async (t) => [rec(t, t[0])],
  fit: async (_o, t) => ({ affinity: AFF[t], http: 200 }),
  demographics: async (id) => ({ gender: { female: FEM[id] }, age: { "24_and_younger": 0, "25_to_29": 0, "45_to_54": 0, "55_and_older": OLD[id] } }),
  views: async (t) => ({ article: t, views: 1000 }),
};
const INPUTS: CompInput[] = IDS.map((t) => ({ title: `${t}lpha` }));

async function result() {
  const run = await runAgent(INPUTS, deps);
  return { run, res: toCheckResult(run, { calls: 0, cacheHits: 0 }) };
}

describe("Why lines", () => {
  it("a split comp whose larger deviation is age says older or younger, tied to the age delta by claims", async () => {
    const { run, res } = await result();
    const d = res.comps.find((c) => c.match.input.title === "Dlpha")!, e = res.comps.find((c) => c.match.input.title === "Elpha")!;
    expect(d.skewSplit && e.skewSplit).toBe(true);
    expect(d.reasons).toContain("Audience split: skews older than the rest of the deck (age gap 0.590, Qloo's estimate), one of several comps that skew differently.");
    // Gender is E's larger deviation: the current wording stays.
    expect(e.reasons).toContain("Audience split: this comp is one of several that skew differently from the deck (Qloo's estimate).");
    // The direction word is a claim on skew:Dlpha.ageDirection; a wrong word is rejected by the guard.
    const st = deterministicReasons.structured(d, res, (k) => compLabel(run.state, k)).find((x) => x.template.startsWith("Audience split"))!;
    const src = sourcesFromState(run.state);
    expect(guardStructured(st, src)).toBeUndefined();
    const flipped = { ...st, claims: st.claims.map((c) => (c.field === "ageDirection" ? { ...c, value: "younger" } : c)) };
    expect(guardStructured(flipped, src)).toBe("skew:Dlpha.ageDirection is older, not younger");
    // Who is flagged does not change: still exactly the two split comps, no outlier.
    expect(res.comps.filter((c) => c.skewSplit).map((c) => c.match.input.title)).toEqual(["Dlpha", "Elpha"]);
    expect(res.comps.some((c) => c.skewFlag)).toBe(false);
  });

  it("the screen shows 3 decimals; export keeps 6; each is guarded at its own rounding", async () => {
    const { run, res } = await result();
    const a = res.comps[0];
    expect(a.reasons).toContain("Fit with the other comps: 0.895. Rank 2 of 5, 0.027 below the next comp.");
    expect(a.reasonsExport).toContain("Fit with the other comps: 0.895432. Rank 2 of 5, 0.027 below the next comp.");
    const screen = [...(res.verdictLines ?? []), ...res.comps.flatMap((c) => c.reasons), ...res.steps!.flatMap((s) => [s.reason, s.outcome ?? "", ...(s.details ?? [])])];
    for (const line of screen) expect(line).not.toMatch(/\d\.\d{4,}/);
    expect(toCsv(res)).toContain("0.895432"); expect(toMarkdown(res)).toContain("Fit with the other comps: 0.895."); // Markdown reads like the page (Oct 30)
    // A score that is right at 3 decimals but wrong at 6 passes on screen and is rejected for export.
    const st = deterministicReasons.structured(a, res, (k) => compLabel(run.state, k)).find((x) => x.template.startsWith("Fit"))!;
    const off = { ...st, claims: st.claims.map((c) => (c.field === "affinity" ? { ...c, value: 0.8951 } : c)) };
    const src = sourcesFromState(run.state);
    expect(guardStructured(atScreen(off), src)).toBeUndefined();
    expect(guardStructured(off, src)).toMatch(/affinity is 0\.895432, not 0\.895100/);
  });

  it("no provider label until a model response exists; the interim string never appears", async () => {
    const { run } = await result();
    const claudeNoResponse = { ...run, provider: "claude", stats: { ...run.stats, responseModel: undefined } };
    const r = toCheckResult(claudeNoResponse, { calls: 0, cacheHits: 0 });
    expect(r.providerLabel).toBeUndefined();
    const all = JSON.stringify(r) + toCsv(r) + toMarkdown(r);
    expect(all).not.toMatch(/no model response/);
  });
});

describe("export audience fields (Qloo's estimate)", () => {
  it("per comp and deck mean at 3 decimals, guarded, labeled; fit stays at 6", async () => {
    const { res } = await result();
    const d = res.comps.find((c) => c.match.input.title === "Dlpha")!.audienceExport!;
    // D: female 0.307, age 0.738; deck mean female 0.131, age 0.148 -> gaps +0.590 age, +0.176 female; distance = max = 0.590.
    expect(d).toEqual({ female: "0.307", age: "0.738", distance: "0.590", largerGap: "age", dAge: "0.590", dFemale: "0.176", ageDirection: "older" });
    // E: female gap -0.702 vs age gap -0.148, so the larger gap is female lean.
    expect(res.comps.find((c) => c.match.input.title === "Elpha")!.audienceExport!.largerGap).toBe("female lean");
    expect(res.deckAudienceExport).toEqual({ meanFemale: "0.131", meanAge: "0.148" });
    const csv = toCsv(res), md = toMarkdown(res);
    // CSV keeps every labeled field; Markdown uses plain columns and drops "skew distance" and "larger gap" (Oct 30).
    for (const h of ["female lean (Qloo's estimate)", "age lean (Qloo's estimate)", "skew distance, max of |age gap| and |female gap| (Qloo's estimate)", "larger gap (Qloo's estimate)", "age gap vs deck mean (Qloo's estimate)", "female gap vs deck mean (Qloo's estimate)", "deck mean female lean (Qloo's estimate)"]) expect(csv.split("\n")[0]).toContain(h);
    expect(csv).toContain('"0.895432"'); // existing fit field keeps 6
    expect(md).toContain("## Audience (Qloo's estimate)");
    expect(md).toContain("| Comp | Female lean | Age lean | Age gap from deck average | Female gap from deck average | Older or younger than the deck | Note |");
    expect(md).toContain("| Dlpha | 0.307 | 0.738 | 0.590 | 0.176 | older |");
    expect(md).not.toMatch(/skew distance|larger gap/i);
    expect(csv.split("\n")[0]).toContain(`"age direction (Qloo's estimate)"`);
    // Threshold line reads the constant.
    expect(md).toContain(`A comp is flagged as an audience outlier when its age gap or female gap is over ${SKEW_THRESHOLD.toFixed(3)}.`);
    expect(md).toContain("Lean values are Qloo scores, not percentages. Age lean direction is older or younger than this deck.");
    expect(md).toContain(`Deck average, all comps: female lean ${res.deckAudienceExport!.meanFemale}; age lean ${res.deckAudienceExport!.meanAge}. This deck leans older overall.`); // mean age +0.148, computed
    expect(md + csv).not.toMatch(/female share|age score|%/);
  });

  it("a comp whose estimate failed exports 'unavailable' plus a note, never invented values", async () => {
    const noDemo: ToolDeps = { ...deps, demographics: async (id) => { if (id === "B") throw new Error("no data"); return deps.demographics(id); } };
    const run = await runAgent(INPUTS, noDemo);
    const res = toCheckResult(run, { calls: 0, cacheHits: 0 });
    const b = res.comps.find((c) => c.match.input.title === "Blpha")!.audienceExport!;
    expect([b.female, b.age, b.distance, b.largerGap, b.dAge, b.dFemale, b.ageDirection]).toEqual(Array(7).fill("unavailable"));
    expect(b.note).toMatch(/^Audience estimate unavailable: no data\.$/);
  });
});
