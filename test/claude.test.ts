import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "@/lib/agent";
import { AgentBudgetError, ClaudeProvider, friendlyModel, PRICES, runCost, SYSTEM, TOOLS, type SendFn } from "@/lib/providers/claude";
import { checkChoice, type Choice } from "@/lib/agent";
import { toCheckResult } from "@/lib/check";
import type { ToolDeps } from "@/lib/tools";
import type { QlooEntity } from "@/lib/qloo";
import type { CompInput } from "@/lib/types";

// Mocked Anthropic client only. No live calls in tests. Invented data.
const tags = (t: string) => [{ tag_id: "g:drama", name: "Drama", type: "urn:tag:genre:media" }, ...(t === "Charlie" ? [{ tag_id: "g:musical", name: "Musical", type: "urn:tag:genre:media" }] : [])];
const rec = (name: string, year: number, id: string): QlooEntity => ({ name, entity_id: id, properties: { release_year: String(year), description: name }, popularity: 0.5, tags: tags(name) });
const DB: Record<string, QlooEntity[]> = { Alpha: [rec("Alpha", 2010, "A")], Bravo: [rec("Bravo", 2011, "B")], Charlie: [rec("Charlie", 2012, "C")] };
const AFF: Record<string, number> = { A: 0.91, B: 0.88, C: 0.93 };
const DEMO: Record<string, number> = { A: 0.1, B: 0.1, C: 0.9 };
const deps: ToolDeps = {
  search: async (t) => DB[t] ?? [],
  fit: async (_o, t) => ({ affinity: AFF[t], http: 200 }),
  demographics: async (id) => ({ gender: { female: DEMO[id] }, age: { "24_and_younger": 0, "25_to_29": 0, "45_to_54": 0, "55_and_older": 0 } }),
  views: async (t) => ({ article: t, views: 1000 }),
};
const INPUTS: CompInput[] = ["Alpha", "Bravo", "Charlie"].map((title) => ({ title }));

/** A fake Messages API: replies with the scripted tool calls in order and records each request body. */
function fakeApi(replies: { name: string; input: Record<string, unknown> }[] | (() => never)) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  const prewarms: Record<string, unknown>[] = [];
  const send: SendFn = async (body) => {
    if (body.max_tokens === 0) { prewarms.push(structuredClone(body)); return { content: [], usage: { input_tokens: 8, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, model: "claude-zeta-9-1" }; }
    bodies.push(structuredClone(body));
    if (typeof replies === "function") replies();
    const r = (replies as { name: string; input: Record<string, unknown> }[])[Math.min(i, (replies as unknown[]).length - 1)];
    i++;
    return {
      content: [{ type: "tool_use", id: `tu_${i}`, name: r.name, input: r.input }],
      usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: i === 1 ? 900 : 0, cache_read_input_tokens: i === 1 ? 0 : 900 },
      stop_reason: "tool_use",
      model: "claude-zeta-9-1",
    };
  };
  return { send, bodies, prewarms };
}
const reason = (template: string, claims: { sourceId: string; field: string }[] = []) => ({ template, claims });
const LOOK = { name: "look_at_tags", input: { comp: "Charlie", basis: { sourceId: "skew:deck", field: "dFemale" }, reason: reason("{0} sits furthest from the deck audience.", [{ sourceId: "skew:deck", field: "outlier" }]) } };
const STOP = { name: "stop", input: { basis: { sourceId: "rank_deck", field: "gap" }, reason: reason("The fit gap is {0}, so stop.", [{ sourceId: "rank_deck", field: "gap" }]) } };

afterEach(() => vi.unstubAllEnvs());

describe("ClaudeProvider (mocked client)", () => {
  it("runs real tool use after the core, logs the cited Qloo value, and records usage incl. cache", async () => {
    const api = fakeApi([LOOK, STOP]);
    const run = await runAgent(INPUTS, deps, new ClaudeProvider({ send: api.send, model: "claude-sonnet-5-5" }));
    const chosen = run.steps.filter((s) => s.origin === "model");
    expect(chosen.map((s) => s.choice!.label)).toEqual(["closer look at Charlie's tags", "stop"]);
    expect(chosen[0].choice!.basis).toMatchObject({ sourceId: "skew:deck", field: "dFemale", value: "0.533" });
    expect(chosen[0].reason).toBe("Charlie sits furthest from the deck audience.");
    expect(run.state.comps[2].tagNote).toMatch(/only this comp is tagged .Musical./);
    expect(run.stats).toMatchObject({ provider: "claude", model: "claude-sonnet-5-5", calls: 2, tokensIn: 108, tokensOut: 60, prewarmCalls: 1, cacheCreationTokens: 900, cacheReadTokens: 900, rejectionsAttempted: 0, fallbacks: 0, screenChanged: true });
    // second request carries the tool_result for the first call
    const m = api.bodies[1].messages as { role: string; content: { type: string; tool_use_id?: string }[] }[];
    expect(m.at(-1)!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    // first turn sends all results; the next only new or changed ones (the tags result), and the newest block carries the moving breakpoint
    const first = JSON.parse((api.bodies[0].messages as { content: { text: string }[] }[])[0].content[0].text);
    expect(Object.keys(first.results)).toContain("deckfit:Bravo");
    const next = m.at(-1)!.content.at(-1) as unknown as { text: string; cache_control?: unknown };
    expect(Object.keys(JSON.parse(next.text).newOrChangedResults)).toEqual(["tags:Charlie"]);
    expect(next.cache_control).toEqual({ type: "ephemeral" });
  });

  it("puts cache_control (ephemeral) on the system prompt and the last tool, and never sends the key in the body", async () => {
    vi.stubEnv("QLOO_ANTHROPIC_API_KEY", "sk-test-not-real");
    const api = fakeApi([STOP]);
    await runAgent(INPUTS, deps, new ClaudeProvider({ send: api.send }));
    const b = api.bodies[0] as { system: { cache_control?: unknown }[]; tools: { cache_control?: unknown }[]; model: string };
    expect(b.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(b.tools.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(b.tools.slice(0, -1).every((t) => !t.cache_control)).toBe(true);
    expect(b.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(api.bodies)).not.toContain("sk-test-not-real");
    expect(TOOLS.map((t) => t.name)).toEqual(["check_pageviews", "look_at_tags", "rerun_after_set_aside", "stop"]);
    expect(SYSTEM).not.toMatch(/\d\.\d{3}/); // no hand-typed scores in the prompt
  });

  it("a refused call goes back as an is_error tool_result once; a second refusal becomes a template step", async () => {
    const badName = { name: "stop", input: { basis: { sourceId: "rank_deck", field: "gap" }, reason: reason("Bravo is weak, stop.") } };
    const api = fakeApi([badName, badName, STOP]);
    const run = await runAgent(INPUTS, deps, new ClaudeProvider({ send: api.send }));
    const second = (api.bodies[1].messages as { content: { type: string; is_error?: boolean; content?: string }[] }[]).at(-1)!.content[0];
    expect(second).toMatchObject({ type: "tool_result", is_error: true });
    expect(second.content).toMatch(/free text names Bravo/);
    expect(run.stats.rejectionsAttempted).toBe(2);
    expect(run.stats.fallbacks).toBe(1);
    const t = run.steps.find((s) => s.origin === "template")!;
    expect(t.reason).not.toMatch(/claude|sonnet/i);
    expect(run.steps.every((s) => !s.rejected)).toBe(true);
  });

  it("scores are identical to the stub", async () => {
    const stub = await runAgent(INPUTS, deps);
    const run = await runAgent(INPUTS, deps, new ClaudeProvider({ send: fakeApi([LOOK, STOP]).send }));
    expect(run.state.comps.map((c) => c.fit?.affinity?.toFixed(6))).toEqual(stub.state.comps.map((c) => c.fit?.affinity?.toFixed(6)));
    expect(run.state.comps.map((c) => c.skew)).toEqual(stub.state.comps.map((c) => c.skew));
    expect(run.verdictLines).toEqual(stub.verdictLines);
  });

  it("an API error is counted apart from guard rejections and the run still finishes on the template", async () => {
    const run = await runAgent(INPUTS, deps, new ClaudeProvider({ send: fakeApi(() => { throw new Error("Anthropic API 529: overloaded"); }).send }));
    expect(run.stoppedBy).toBe("finish");
    expect(run.stats.fallbacks).toBeGreaterThan(0);
    expect(run.stats.rejectionsAttempted).toBe(0);
    expect(run.stats.apiErrors).toBe(run.stats.fallbacks);
    expect(run.steps.every((s) => s.origin !== "model")).toBe(true);
  });

  it("throws not configured without a key", () => {
    vi.stubEnv("QLOO_ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => new ClaudeProvider()).toThrow(/not configured/);
  });

  it("prices a run from the published rates", () => {
    expect(PRICES["claude-sonnet-5-5"]).toMatchObject({ input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.1, minCacheable: 512 });
    const c = runCost("claude-sonnet-5-5", { tokensIn: 1_000_000, tokensOut: 100_000, cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000 })!;
    expect(c.total).toBeCloseTo(2 + 1 + 2.5 + 0.1, 9);
  });
});

describe("model label comes from the API response", () => {
  it("stores the response model per run and derives the friendly name; the stub stays stub", async () => {
    const run = await runAgent(INPUTS, deps, new ClaudeProvider({ send: fakeApi([STOP]).send, model: "claude-sonnet-5-5" }));
    expect(run.stats.responseModel).toBe("claude-zeta-9-1"); // what the response said, not the requested id
    expect(toCheckResult(run, { calls: 0, cacheHits: 0 }).providerLabel).toBe("Claude Zeta 9.1");
    expect(toCheckResult(await runAgent(INPUTS, deps), { calls: 0, cacheHits: 0 }).providerLabel).toBe("stub");
    expect(friendlyModel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(friendlyModel("claude-opus-4-20250514")).toBe("Claude Opus 4");
    expect(friendlyModel("weird")).toBe("weird");
  });
});

describe("names and slots in reasons", () => {
  // Deck with a comp titled "Her" (as in Dream Hackers).
  const HDB: Record<string, QlooEntity[]> = { ...DB, Her: [rec("Her", 2013, "H")] };
  const hdeps: ToolDeps = { ...deps, search: async (t) => HDB[t] ?? [], fit: async (_o, t) => ({ affinity: ({ ...AFF, H: 0.8 } as Record<string, number>)[t], http: 200 }), demographics: async (id) => ({ gender: { female: ({ ...DEMO, H: 0.5 } as Record<string, number>)[id] }, age: { "24_and_younger": 0, "25_to_29": 0, "45_to_54": 0, "55_and_older": 0 } }) };
  const HIN: CompInput[] = ["Alpha", "Bravo", "Charlie", "Her"].map((title) => ({ title }));
  const stop = (template: string, claims: { sourceId: string; field: string; kind?: "name" | "number" }[] = []): Choice => ({ tool: "stop", basis: { sourceId: "rank_deck", field: "gap" }, reason: { template, claims } });
  const state = async () => (await runAgent(HIN, hdeps)).state;

  it("'her' as a pronoun passes", async () => {
    const s = await state();
    expect(checkChoice(s, stop("{0} fits least; her gap is {1}, so stop.", [{ sourceId: "rank_deck", field: "lowest", kind: "name" }, { sourceId: "rank_deck", field: "gap", kind: "number" }]))).toBeUndefined();
  });
  it("'Her' outside a claim is rejected", async () => {
    expect(checkChoice(await state(), stop("Look at Her before stopping."))).toMatch(/free text names Her; put comp names in a claim/);
  });
  it("sentence-start 'Her' is a plain word unless Her is claimed in the same reason", async () => {
    const s = await state();
    expect(checkChoice(s, stop("Her audience skews younger."))).toBeUndefined();
    expect(checkChoice(s, stop("Her audience skews younger. {0} is fine.", [{ sourceId: "skew:Alpha", field: "title", kind: "name" }]))).toBeUndefined();
    const herIsClaimed = { tool: "look_at_tags", comp: "Her", basis: { sourceId: "deckfit:Her", field: "affinity" }, reason: { template: "Her audience skews younger. {0} is worth a look.", claims: [{ sourceId: "skew:Her", field: "title", kind: "name" }] } } as Choice;
    expect(checkChoice(s, herIsClaimed)).toMatch(/free text names Her; put comp names in a claim/);
    expect(checkChoice(s, stop("Stop, since Her audience skews younger."))).toMatch(/free text names Her/); // mid-sentence is still a mention
  });
  it("a film name not in the deck is rejected", async () => {
    expect(checkChoice(await state(), stop("This deck reads like Avatar, so stop."))).toMatch(/free text names Avatar, which is not a comp in this deck/);
    expect(checkChoice(await state(), stop("Stop now, the deck is like Blade Runner."))).toMatch(/free text names Blade/);
  });
  it("a score placed in the name slot is rejected", async () => {
    const s = await state();
    expect(checkChoice(s, stop("{0} has the lowest fit, so stop.", [{ sourceId: "rank_deck", field: "lowestScore", kind: "number" }]))).toMatch(/slot \{0\} is a name slot but holds a number/);
    expect(checkChoice(s, stop("Lowest is {0}, so stop.", [{ sourceId: "deckfit:Her", field: "affinity", kind: "name" }]))).toMatch(/name slot but holds a number/);
    expect(checkChoice(s, stop("{0}'s tags are covered, so stop.", [{ sourceId: "deckfit:Her", field: "affinity" }]))).toMatch(/name slot/);
    expect(checkChoice(s, stop("Gap is {0}, so stop.", [{ sourceId: "rank_deck", field: "lowest", kind: "number" }]))).toMatch(/number slot/);
  });
});

describe("latency levers (mocked client)", () => {
  it("several tool calls in one turn run as separate Model chose steps, concurrently, each answered by its own tool_result", async () => {
    let active = 0, peak = 0;
    const slow: ToolDeps = { ...deps, views: async (t) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 30)); active--; return { article: t, views: 1000 }; } };
    const both: SendFn = async (body): Promise<Awaited<ReturnType<SendFn>>> => {
      if (body.max_tokens === 0) return { content: [], usage: {} };
      const n = (body.messages as unknown[]).length;
      const content = n === 1
        ? [
          { type: "tool_use", id: "a", name: "look_at_tags", input: LOOK.input },
          { type: "tool_use", id: "b", name: "check_pageviews", input: { comps: ["Alpha"], basis: { sourceId: "count:matched", field: "matched" }, reason: reason("Popularity context.") } },
          { type: "tool_use", id: "c", name: "check_pageviews", input: { comps: ["Bravo"], basis: { sourceId: "count:matched", field: "matched" }, reason: reason("Popularity context.") } },
        ]
        : [{ type: "tool_use", id: "d", name: "stop", input: STOP.input }];
      return { content, usage: { input_tokens: 10, output_tokens: 10 }, model: "claude-zeta-9-1" };
    };
    const bodies: Record<string, unknown>[] = [];
    const run = await runAgent(INPUTS, slow, new ClaudeProvider({ send: async (b) => { bodies.push(structuredClone(b)); return both(b); } }));
    const chosen = run.steps.filter((s) => s.origin === "model").map((s) => s.choice!.label);
    expect(chosen).toEqual(["closer look at Charlie's tags", "pageview check on Alpha", "pageview check on Bravo", "stop"]);
    expect(peak).toBe(2); // the two pageview picks ran at the same time
    expect(run.stats.parallelTurns).toBe(1);
    const second = bodies.filter((b) => b.max_tokens !== 0)[1].messages as { content: { type: string; tool_use_id?: string }[] }[];
    expect(second.at(-1)!.content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id)).toEqual(["a", "b", "c"]);
  });

  it("a duplicate pick in the same turn is refused and the rest still run", async () => {
    const send: SendFn = async (body) => {
      if (body.max_tokens === 0) return { content: [], usage: {} };
      const n = (body.messages as unknown[]).length;
      return n === 1
        ? { content: [{ type: "tool_use", id: "a", name: "look_at_tags", input: LOOK.input }, { type: "tool_use", id: "b", name: "look_at_tags", input: LOOK.input }], usage: {} }
        : { content: [{ type: "tool_use", id: "c", name: "stop", input: STOP.input }], usage: {} };
    };
    const run = await runAgent(INPUTS, deps, new ClaudeProvider({ send }));
    expect(run.stats.rejections).toEqual(["Charlie tags already picked in this turn"]);
    expect(run.steps.filter((s) => s.origin === "model")).toHaveLength(2);
    expect(run.stats.fallbacks).toBe(0);
  });

  it("prewarm is a max_tokens 0 request with the same tools, system and thinking, and no deck data", async () => {
    const api = fakeApi([STOP]);
    await runAgent(INPUTS, deps, new ClaudeProvider({ send: api.send }));
    expect(api.prewarms).toHaveLength(1);
    const w = api.prewarms[0] as Record<string, unknown>, b = api.bodies[0];
    expect(w.max_tokens).toBe(0);
    expect(w.tools).toEqual(b.tools); expect(w.system).toEqual(b.system); expect(w.thinking).toEqual(b.thinking);
    expect(JSON.stringify(w.messages)).toBe(JSON.stringify([{ role: "user", content: "warmup" }]));
  });

  it("core_result arrives before any chosen step, with the final verdict and scores", async () => {
    const { runCheckWith } = await import("@/lib/check");
    const events: { type: string; at: number; result?: { verdictLines?: string[]; comps: { fit?: { affinity?: number } }[] }; step?: { origin?: string; note?: unknown } }[] = [];
    const final = await runCheckWith(INPUTS, deps, { calls: 0, cacheHits: 0 }, { provider: new ClaudeProvider({ send: fakeApi([LOOK, STOP]).send }), onEvent: (e) => events.push({ ...(e as object), at: events.length } as never) });
    const core = events.findIndex((e) => e.type === "core_result");
    const firstChosen = events.findIndex((e) => e.type === "step" && e.step?.origin === "model");
    expect(core).toBeGreaterThan(-1);
    expect(core).toBeLessThan(firstChosen);
    expect(events[core].result!.verdictLines).toEqual(final.verdictLines);
    expect(events[core].result!.comps.map((c) => c.fit?.affinity)).toEqual(final.comps.map((c) => c.fit?.affinity));
    const noted = events.find((e) => e.type === "step" && e.step?.note);
    expect(noted!.step!.note).toMatchObject({ comp: "c2", text: expect.stringMatching(/^Qloo tags:/) });
  });
});

describe("spend cap mid-run", () => {
  it("a budget error ends the run instead of falling back to the template", async () => {
    const send: SendFn = async (body) => { if (body.max_tokens === 0) return { content: [] }; throw new AgentBudgetError(); };
    await expect(runAgent(INPUTS, deps, new ClaudeProvider({ send }))).rejects.toBeInstanceOf(AgentBudgetError);
  });
});
