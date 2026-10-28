import { describe, expect, it } from "vitest";
import { checkEventStream } from "@/lib/stream";
import { readEvents, type CheckEvent } from "@/lib/events";
import { runCheckWith } from "@/lib/check";
import { recordedStamp } from "@/lib/stamp";
import { AgentBudgetError, AGENT_BUDGET_AFTER_CORE, AGENT_BUDGET_USED, ClaudeProvider, type SendFn } from "@/lib/providers/claude";
import type { QlooEntity } from "@/lib/qloo";
import type { ToolDeps } from "@/lib/tools";
import type { CompInput } from "@/lib/types";

// Mocked model and Qloo only. Invented data. No live calls.
const rec = (name: string, id: string): QlooEntity => ({ name, entity_id: id, properties: { release_year: "2010" }, popularity: 0.5, tags: [{ tag_id: "t" }] });
const AFF: Record<string, number> = { A: 0.91, B: 0.85, C: 0.93, D: 0.9 };
const deps: ToolDeps = {
  search: async (t) => [rec(t, t[0])],
  fit: async (_o, t) => ({ affinity: AFF[t], http: 200 }),
  demographics: async (id) => ({ gender: { female: id === "C" ? 0.9 : 0.1 }, age: { "24_and_younger": 0, "25_to_29": 0, "45_to_54": 0, "55_and_older": 0 } }),
  views: async (t) => ({ article: t, views: t.length * 1000 }),
};
const INPUTS: CompInput[] = ["Alpha", "Bravo", "Charlie", "Delta"].map((title) => ({ title, year: 2010 }));
const stats = () => ({ calls: 0, cacheHits: 0 });
const throwing = (err: () => Error): SendFn => async (body) => { if (body.max_tokens === 0) return { content: [] }; throw err(); };
async function run(send: SendFn) {
  const out: CheckEvent[] = [];
  const s = checkEventStream((onEvent) => runCheckWith(INPUTS, deps, stats(), { provider: new ClaudeProvider({ send }), onEvent }), INPUTS.length);
  for await (const e of readEvents(s)) out.push(e);
  return out;
}

describe("budget error after Qloo results streamed", () => {
  it("keeps the core result on screen with the after-core budget line under it", async () => {
    const ev = await run(throwing(() => new AgentBudgetError()));
    const core = ev.find((e) => e.type === "core_result") as Extract<CheckEvent, { type: "core_result" }>;
    const last = ev.at(-1) as Extract<CheckEvent, { type: "result" }>;
    expect(core).toBeTruthy();
    expect(last.type).toBe("result");
    expect(last.result.verdictLines).toEqual(core.result.verdictLines);
    expect(last.result.notes.at(-1)).toBe(AGENT_BUDGET_AFTER_CORE);
    expect(AGENT_BUDGET_AFTER_CORE).toBe("These scores are computed from Qloo's data. The agent's monthly budget for this demo is used up, so it didn't choose any extra steps. The recorded Pennywell sample still plays.");
  });
  it("with nothing streamed, the plain budget line stays", async () => {
    const out: CheckEvent[] = [];
    for await (const e of readEvents(checkEventStream(async () => { throw new AgentBudgetError(); }, 4))) out.push(e);
    expect(out.at(-1)).toEqual({ type: "error", error: AGENT_BUDGET_USED });
  });
});

describe("template fallback", () => {
  it("API failures make template steps, and the status line never counts them as Claude's", async () => {
    const ev = await run(throwing(() => new Error("Anthropic API 500: overloaded")));
    const r = (ev.at(-1) as Extract<CheckEvent, { type: "result" }>).result;
    const steps = r.steps ?? [];
    const chosen = steps.filter((s) => s.origin !== "core");
    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.every((s) => s.origin === "template")).toBe(true);
    const stamp = recordedStamp({ ...r, recorded: { deck: "d", at: "2026-10-10T12:00:00Z" }, provider: "claude", providerLabel: "Claude Test 9" });
    expect(stamp).toMatch(/ chose 0 of \d+ steps live$/);
  });
});
