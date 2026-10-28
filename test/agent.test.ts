import { describe, expect, it } from "vitest";
import { checkChoice, runAgent, StubProvider, stubChoice, type Choice, type ModelProvider } from "@/lib/agent";
import { guardStructured, render, say, type Structured } from "@/lib/claims";
import { sourcesFromState } from "@/lib/sources";
import { computeDeckFit, type FitScorer } from "@/lib/deckfit";
import { ClaudeProvider } from "@/lib/providers/claude";
import type { ToolDeps } from "@/lib/tools";
import type { QlooEntity } from "@/lib/qloo";
import type { CompInput } from "@/lib/types";

// Mocked, invented data only. No real Qloo responses.
const rec = (name: string, year: number, id: string, extra: Partial<QlooEntity> = {}): QlooEntity => ({ name, entity_id: id, properties: { release_year: String(year), description: `${name} directed by Pat Doe` }, popularity: 0.5, tags: [{ tag_id: "t" }], ...extra });
const DB: Record<string, QlooEntity[]> = {
  "Alpha": [rec("Alpha", 2010, "A")],
  "Bravo": [rec("Bravo", 2011, "B")],
  "Charlie": [rec("Charlie", 2012, "C")],
  "Delta": [rec("Delta", 2013, "D")],
  "Echo": [rec("Echo", 2014, "E", { popularity: undefined, tags: [] })], // thin
  "Ghost": [], // unmatched
};
const AFF: Record<string, number> = { A: 0.6804, B: 0.6387, C: 0.7041, D: 0.9, E: 0.5 };
const scorer: FitScorer = async (others, target) => {
  if (target === "D") return { http: 400, error: "HTTP 400" }; // unscored
  const penalty = others.includes("D") ? 0.01 : 0; // D in the inputs moves the others
  return { affinity: AFF[target] - penalty + others.length * 0.001, http: 200 };
};
const DEMO: Record<string, { female: number; age: number }> = { A: { female: 0.1, age: 0 }, B: { female: 0.1, age: 0.05 }, C: { female: 0.9, age: 0 } };
const deps: ToolDeps = {
  search: async (t) => DB[t] ?? [],
  fit: scorer,
  demographics: async (id) => ({ gender: { female: DEMO[id].female }, age: { "24_and_younger": 0, "25_to_29": 0, "45_to_54": DEMO[id].age, "55_and_older": DEMO[id].age } }),
  views: async (t) => ({ article: t, views: ({ Alpha: 5000, Bravo: 1200, Charlie: 90000 } as Record<string, number>)[t] }),
};
const INPUTS: CompInput[] = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Ghost"].map((title) => ({ title }));

describe("agent loop with StubProvider", () => {
  it("follows the code rules step by step", async () => {
    const run = await runAgent(INPUTS, deps);
    expect(run.stoppedBy).toBe("finish");
    expect(run.steps.every((s) => !s.rejected)).toBe(true);
    expect(run.steps.map((s) => `${s.action}${s.comp ? ":" + s.comp : ""}`)).toEqual([
      "resolve_comps",
      "drop_comp:c5", // Ghost unmatched
      "set_aside_comp:c4", // Echo thin
      "score_deck",
      "set_aside_comp:c3", // Delta unscored
      "rerun",
      "skew", "rank_deck",
      "flag_consider_cutting:c1", // Bravo lowest
      "flag_skew:c2", // Charlie outlier on gender
      "pageviews", "stop", // chosen steps (the stub: pageviews for every scored comp, then stop)
      "finish",
    ]);
    expect(run.steps.filter((s) => s.origin === "core").map((s) => s.action)).not.toContain("pageviews");
    expect(run.steps.filter((s) => s.origin === "stub").map((s) => s.choice!.label)).toEqual(["pageview check on Alpha, Bravo, Charlie", "stop"]);
    expect(run.stats).toMatchObject({ provider: "stub", tokensIn: 0, rejectionsAttempted: 0, fallbacks: 0, screenChanged: false });
    expect(run.state.leastViewed).toBe("c1");
    const cut = run.steps.find((s) => s.action === "flag_consider_cutting")!;
    expect(cut.reason).toBe('"Bravo" ranks 3 of 3 at 0.641, 0.042 below the next comp; the rest spread 0.024, so: Consider cutting.');
    const res = run.steps[0];
    expect(res.outcome).toBe("Matched 5 of 6 comps to Qloo movie records. 1 unmatched: Ghost.");
    expect(res.details).toHaveLength(6);
    expect(run.verdictLines).toEqual([
      "5 of 6 comps matched.",
      "Audience outlier: Charlie brings a more female audience than the rest of your comps (Qloo's estimate). Check it.",
      "Consider cutting: Bravo (0.641, 0.042 below the next comp).",
    ]);
    expect(run.verdictRejected).toBeUndefined();
    for (const s of run.steps) expect(s.reason).not.toMatch(/\n/);
  });

  it("gives the same scores as plain code (no agent)", async () => {
    const run = await runAgent(INPUTS, deps);
    const plain = await computeDeckFit([{ key: "c0", entityId: "A" }, { key: "c1", entityId: "B" }, { key: "c2", entityId: "C" }, { key: "c3", entityId: "D" }], scorer);
    for (const k of ["c0", "c1", "c2"]) {
      expect(run.state.comps.find((c) => c.key === k)!.fit!.affinity).toBe(plain.rows.get(k)!.affinity);
    }
    expect(run.state.comps.find((c) => c.key === "c3")!.fit!.status).toBe("Unscored");
  });

  it("verdict audience line for k=0 and k>=2, and close-call fit line", async () => {
    const flat: ToolDeps = { ...deps, demographics: async () => ({ gender: { female: 0.1 }, age: { "24_and_younger": 0, "25_to_29": 0, "45_to_54": 0, "55_and_older": 0 } }) };
    const r0 = await runAgent(INPUTS, flat);
    expect(r0.verdictLines![1]).toBe("No audience outlier.");
    const SPLIT: Record<string, number> = { A: 0.9, B: 0, C: -0.6 };
    const split: ToolDeps = { ...deps, demographics: async (id) => ({ gender: { female: SPLIT[id] }, age: { "24_and_younger": 0, "25_to_29": 0, "45_to_54": 0, "55_and_older": 0 } }) };
    const r2 = await runAgent(INPUTS, split);
    expect(r2.verdictLines![1]).toBe("Audience split: Alpha and Charlie skew differently (Qloo's estimate).");
    expect(r2.state.skewOutlier).toBeUndefined();
    const fs = r2.steps.find((x) => x.action === "flag_skew")!;
    expect(fs.comp).toBeUndefined();
    expect(fs.reason).toBe('Audience split: "Alpha" and "Charlie" are each more than 0.3 from the deck mean, so no single outlier (Qloo\'s estimate).');
    // close call: make the lowest sit close to the others
    const close: ToolDeps = { ...deps, fit: async (others, t) => (t === "D" ? { http: 400, error: "HTTP 400" } : { affinity: ({ A: 0.8302, B: 0.8113, C: 0.8617 } as Record<string, number>)[t], http: 200 }) };
    const rc = await runAgent(INPUTS, close);
    expect(rc.verdictLines![2]).toBe("Fit ranking: no comp clearly stands apart. Lowest fit, close call: Bravo (0.811, 0.019 below the next comp).");
  });

  it("says each record names its director only when true for all matched", async () => {
    const withDir = INPUTS.slice(0, 3).map((c) => ({ ...c, director: "Pat Doe" }));
    expect((await runAgent(withDir, deps)).steps[0].outcome).toBe("Matched 3 of 3 comps to Qloo movie records (each record names its director).");
    const mixed = [{ ...INPUTS[0], director: "Pat Doe" }, INPUTS[1], INPUTS[2]];
    expect((await runAgent(mixed, deps)).steps[0].outcome).toBe("Matched 3 of 3 comps to Qloo movie records.");
  });

  it("stops at the step cap", async () => {
    const run = await runAgent(INPUTS, deps, new StubProvider(), { maxSteps: 3, maxTokens: 1000, maxChoices: 4 });
    expect(run.steps).toHaveLength(3);
    expect(run.stoppedBy).toBe("max_steps");
  });
});

/** A scripted provider for the choice phase. Each call returns the next scripted choice (or error). */
function scripted(name: string, answers: (Choice | { error: string } | ((v: Parameters<ModelProvider["chooseNext"]>[0]) => Choice))[], usage = { input: 100, output: 20, cacheCreation: 0, cacheRead: 0 }): ModelProvider & { feedback: unknown[] } {
  let i = 0;
  const feedback: unknown[] = [];
  return {
    name, model: "test-model", origin: "model", feedback,
    async chooseNext(view, fb) {
      feedback.push(fb);
      const a = answers[Math.min(i++, answers.length - 1)];
      if (typeof a === "function") return { choice: a(view), usage };
      return "error" in a ? { error: a.error, usage } : { choice: a, usage };
    },
  };
}
const why = (template: string, claims: { sourceId: string; field: string }[] = []) => ({ template, claims });
const STOP: Choice = { tool: "stop", basis: { sourceId: "rank_deck", field: "gap" }, reason: why("Gap {0} is clear, so stop.", [{ sourceId: "rank_deck", field: "gap" }]) };

describe("choice phase", () => {
  it("the core always runs first and is identical whatever the provider picks", async () => {
    const stub = await runAgent(INPUTS, deps);
    const p = scripted("m", [{ tool: "look_at_tags", comp: "Charlie", basis: { sourceId: "skew:deck", field: "dFemale" }, reason: why("{0} has the widest audience gap, {1}.", [{ sourceId: "skew:deck", field: "outlier" }, { sourceId: "skew:deck", field: "dFemale" }]) }, STOP]);
    const run = await runAgent(INPUTS, deps, p);
    const core = (r: typeof run) => r.steps.filter((s) => s.origin === "core").map((s) => `${s.action}:${s.reason}:${s.outcome}`);
    expect(core(run)).toEqual(core(stub));
    for (const c of run.state.comps) expect(c.fit?.affinity).toBe(stub.state.comps.find((x) => x.key === c.key)!.fit?.affinity);
    expect(run.verdictLines).toEqual(stub.verdictLines);
    const chose = run.steps.find((s) => s.origin === "model")!;
    expect(chose.choice!.label).toBe("closer look at Charlie's tags");
    expect(chose.choice!.basis).toEqual({ sourceId: "skew:deck", field: "dFemale", phrase: "audience gender gap", value: "0.533" });
    expect(chose.reason).toBe("Charlie has the widest audience gap, 0.533.");
    expect(run.stats.choices).toEqual(["closer look at Charlie's tags", "stop"]);
  });

  it("retries once with the rejection reason, then uses the choice; nothing rejected reaches the steps", async () => {
    const bad: Choice = { tool: "check_pageviews", comps: ["Avatar"], basis: { sourceId: "count:matched", field: "matched" }, reason: why("Check it.") };
    const p = scripted("m", [bad, { ...bad, comps: ["Bravo"] }, STOP]);
    const run = await runAgent(INPUTS, deps, p);
    expect(run.stats.rejectionsAttempted).toBe(1);
    expect(run.stats.fallbacks).toBe(0);
    expect(p.feedback[1]).toEqual({ results: ["Refused: Avatar is not a scored comp. Nothing ran."] });
    expect(run.steps.every((s) => !s.rejected)).toBe(true);
    expect(run.steps.filter((s) => s.origin === "model").map((s) => s.choice!.label)).toEqual(["pageview check on Bravo", "stop"]);
    expect(run.state.comps.find((c) => c.key === "c0")!.views).toBeUndefined(); // only what it picked
  });

  it("falls back to the template choice after two refusals, tagged template, and counts it", async () => {
    const liar: Choice = { tool: "stop", basis: { sourceId: "count:matched", field: "matched" }, reason: why("Titanic made two billion, about 2,000 million.") };
    const run = await runAgent(INPUTS, deps, scripted("liar", [liar]));
    expect(run.stoppedBy).toBe("finish");
    expect(run.stats.rejectionsAttempted).toBeGreaterThanOrEqual(2);
    expect(run.stats.fallbacks).toBeGreaterThanOrEqual(1);
    const t = run.steps.filter((s) => s.origin === "template");
    expect(t[0].choice!.label).toBe("pageview check on Alpha, Bravo, Charlie");
    expect(t.every((s) => !/test-model|claude/i.test(`${s.reason} ${s.choice!.label}`))).toBe(true);
    expect(run.steps.every((s) => !s.rejected && !/digit/.test(s.reason))).toBe(true);
  });

  it("rejects a basis that is not a Qloo result, a wrong field, a comp name in free text, and a real number on the wrong comp", async () => {
    const p = scripted("m", [
      { ...STOP, basis: { sourceId: "pageviews:Bravo", field: "views" } },
      { ...STOP, basis: { sourceId: "rank_deck", field: "nope" } },
      { ...STOP, basis: { sourceId: "rank_deck", field: "label" } },
      { ...STOP, reason: why("Bravo is weak, so stop.") },
      { ...STOP, reason: why("Charlie fit {0}.", [{ sourceId: "deckfit:Bravo", field: "affinity" }]) },
      STOP,
    ]);
    const run = await runAgent(INPUTS, deps, p, { maxSteps: 50, maxTokens: 1e6, maxChoices: 4 });
    const rej = run.stats.rejections;
    expect(rej[0]).toMatch(/basis must be a Qloo result/);
    expect(rej[1]).toMatch(/no usable field nope/);
    expect(rej[2]).toMatch(/rank_deck\.label is not a number/);
    expect(rej[3]).toMatch(/free text names Bravo/);
    expect(checkChoice(run.state, { ...STOP, reason: why("Charlie fit {0}.", [{ sourceId: "deckfit:Bravo", field: "affinity" }]) })).toMatch(/free text names Charlie/);
    expect(checkChoice(run.state, STOP)).toBeUndefined();
    expect(run.steps.every((s) => !s.rejected)).toBe(true);
  });

  it("a closer look can add a guarded Qloo tag note to that comp's Why line", async () => {
    const tagged: ToolDeps = {
      ...deps,
      search: async (t) => (DB[t] ?? []).map((e) => ({ ...e, tags: [
        { tag_id: "g:drama", name: "Drama", type: "urn:tag:genre:media" },
        ...(t === "Charlie" ? [{ tag_id: "g:musical", name: "Musical", type: "urn:tag:genre:media" }] : []),
      ] })),
    };
    const p = scripted("m", [{ tool: "look_at_tags", comp: "Charlie", basis: { sourceId: "skew:deck", field: "dFemale" }, reason: why("Look at {0}.", [{ sourceId: "skew:deck", field: "outlier" }]) }, STOP]);
    const run = await runAgent(INPUTS, tagged, p);
    const c = run.state.comps.find((x) => x.key === "c2")!;
    expect(c.tagLook).toMatchObject({ totalTags: 2, sharedWithDeck: 1, uniqueGenre: "Musical" });
    expect(c.tagNote).toBe("Qloo tags: shares 1 of 2 with the rest of the deck; only this comp is tagged \u201cMusical\u201d.");
    expect(run.stats.screenChanged).toBe(true);
    const stub = await runAgent(INPUTS, tagged);
    expect(stub.state.comps.every((x) => !x.tagNote)).toBe(true);
  });

  it("stops choosing at the token cap and the choice cap", async () => {
    const costly = scripted("m", [(v) => stubChoice(v)], { input: 1000, output: 0, cacheCreation: 0, cacheRead: 0 });
    const r1 = await runAgent(INPUTS, deps, costly, { maxSteps: 50, maxTokens: 1000, maxChoices: 4 });
    expect(r1.stats.rejections).toEqual([]); expect(r1.stats.calls).toBe(1);
    expect(r1.stats.capHit).toBe("max_tokens");
    expect(r1.stoppedBy).toBe("finish");
    const loop = scripted("m", [(v) => ({ tool: "look_at_tags", comp: v.comps.find((c) => c.scored && !c.tagsChecked)!.label, basis: { sourceId: "count:matched", field: "matched" }, reason: why("Look closer.") })]);
    const r2 = await runAgent(INPUTS, deps, loop, { maxSteps: 50, maxTokens: 1e6, maxChoices: 2 });
    expect(r2.stats.choices).toHaveLength(2);
    expect(r2.stats.capHit).toBe("max_choices");
  });
});

describe("source-tagged claims guard", () => {
  const sources = async () => {
    const run = await runAgent(INPUTS, deps);
    return { run, src: sourcesFromState(run.state) };
  };

  it("accepts correct claims, and the stub and verdict go through it", async () => {
    const { run, src } = await sources();
    expect(run.verdictClaims!.length).toBeGreaterThan(0);
    const ok = say().quoted("deckfit:Bravo", "title", "Bravo").text(" scored ").claim("deckfit:Bravo", "affinity", 0.641, "f3")
      .text(", rank ").claim("rank:Bravo", "rank", 3, "int").text(" of ").claim("rank:Bravo", "of", 3, "int")
      .text("; ").claim("pageviews:Bravo", "views", 1200, "thousands").text(" views.").done();
    expect(guardStructured(ok, src)).toBeUndefined();
    expect(render(ok)).toBe('"Bravo" scored 0.641, rank 3 of 3; 1,200 views.');
    for (const st of run.steps) expect(st.claims).toBeDefined();
  });

  it("rejects a real number from the wrong source (Charlie's score attributed to Bravo)", async () => {
    const { run, src } = await sources();
    const charlie = run.state.comps.find((c) => c.input.title === "Charlie")!.fit!.affinity!;
    const bad = say().quoted("deckfit:Bravo", "title", "Bravo").text(" scored ").claim("deckfit:Bravo", "affinity", charlie, "f3").text(".").done();
    expect(guardStructured(bad, src)).toMatch(/deckfit:Bravo\.affinity is 0\.641, not 0\.706/);
    // The same number with its true source passes.
    const good = say().claim("deckfit:Charlie", "affinity", charlie, "f3").done();
    expect(guardStructured(good, src)).toBeUndefined();
  });

  it("rejects a wrong field", async () => {
    const { src } = await sources();
    const gap = src.get("rank_deck")!.gap as number;
    expect(guardStructured(say("Gap ").claim("rank_deck", "spread", gap, "f3").done(), src)).toMatch(/rank_deck\.spread/);
    expect(guardStructured(say("Gap ").claim("rank_deck", "margin", gap, "f3").done(), src)).toMatch(/no field margin/);
  });

  it("rejects a bare digit in free text", async () => {
    const { src } = await sources();
    expect(guardStructured(say("Would gross 40 million.").done(), src)).toMatch(/digit/);
    expect(guardStructured(say("Bravo is ").claim("deckfit:Bravo", "affinity", 0.641, "f3").text(" vs 0.9").done(), src)).toMatch(/digit/);
  });

  it("rejects '6 of 6 matched' when the matched count is 5", async () => {
    const { src } = await sources();
    const lie = say().claim("count:matched", "matched", 6, "int").text(" of ").claim("count:matched", "total", 6, "int").text(" matched.").done();
    expect(guardStructured(lie, src)).toMatch(/count:matched\.matched is 5, not 6/);
    const truth = say().claim("count:matched", "matched", 5, "int").text(" of ").claim("count:matched", "total", 6, "int").text(" matched.").done();
    expect(guardStructured(truth, src)).toBeUndefined();
  });

  it("rejects unknown sources, unquoted-claim names in quotes, unused claims and multi-line text", async () => {
    const { src } = await sources();
    expect(guardStructured(say().claim("deckfit:Avatar", "affinity", 0.9, "f3").done(), src)).toMatch(/unknown source deckfit:Avatar/);
    expect(guardStructured(say('"Avatar" is a better comp.').done(), src)).toMatch(/quoted names must be claims/);
    const unused: Structured = { template: "Fine.", claims: [{ sourceId: "rule", field: "minScored", value: 3, fmt: "int" }] };
    expect(guardStructured(unused, src)).toMatch(/not used/);
    expect(guardStructured(say("line one\nline two").done(), src)).toMatch(/one line/);
    expect(guardStructured({ template: "Gap {0}.", claims: [] }, src)).toMatch(/no claim/);
  });

});

