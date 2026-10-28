/**
 * Slow or failing audience calls: the run still closes well under 60 s, the comps without an estimate are
 * marked unavailable (never invented), fit scores do not move, and the verdict says the audience check is
 * incomplete. Uses the cached Pennywell Qloo results (no live calls); skipped where that cache is absent.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { QlooClient } from "@/lib/qloo";
import { liveDeps, runCheckWith, type CheckProgress } from "@/lib/check";
import { StubProvider } from "@/lib/agent";
import { PENNYWELL } from "@/lib/demo";
import { checkEventStream } from "@/lib/stream";
import { readEvents } from "@/lib/events";
import { toCsv, toMarkdown } from "@/lib/export";
import { compareRuns, NOT_COMPARABLE } from "@/lib/compare";
import type { ToolDeps } from "@/lib/tools";
import type { CheckResult } from "@/lib/types";

const cached = existsSync(path.resolve(__dirname, "../.cache"));
const hang = () => new Promise<never>(() => {}); // never settles and ignores its signal

async function cachedRun(wrap?: (d: ToolDeps, ids: Record<string, string>) => ToolDeps) {
  delete process.env.QLOO_API_KEY; // cache only: a miss fails before any request goes out
  const q = new QlooClient();
  const base = liveDeps(q, false);
  const ids: Record<string, string> = {};
  const probe = await runCheckWith(PENNYWELL, base, { calls: 0, cacheHits: 0 }, { provider: new StubProvider() });
  for (const c of probe.comps) ids[c.match.input.title] = c.fit!.entityId;
  expect(q.stats.calls).toBe(0);
  const deps = wrap ? wrap(base, ids) : base;
  const events: CheckProgress[] = [];
  const t0 = Date.now();
  const stream = checkEventStream((on) => runCheckWith(PENNYWELL, deps, q.stats, { provider: new StubProvider(), onEvent: (e) => { events.push(e); on(e); } }), PENNYWELL.length);
  const all = [];
  for await (const e of readEvents(stream)) all.push(e);
  const ms = Date.now() - t0;
  const last = all.at(-1)!;
  return { probe, ms, last, result: last.type === "result" ? last.result : undefined, events };
}
const scores = (r: CheckResult) => Object.fromEntries(r.comps.map((c) => [c.match.input.title, c.fit?.affinity?.toFixed(6)]));
const hangFor = (title: string) => (d: ToolDeps, ids: Record<string, string>): ToolDeps => ({ ...d, demographics: (id, o) => (id === ids[title] ? hang() : d.demographics(id, o)) });

describe.skipIf(!cached)("audience estimates with a slow or hanging call (cached Pennywell)", () => {
  it("Winchester's call hangs: run closes in time, Winchester unavailable, verdict says incomplete, fit scores unchanged", async () => {
    const r = await cachedRun(hangFor("Winchester"));
    expect(r.ms).toBeLessThan(60_000);
    expect(r.ms).toBeLessThan(12_000); // the 5 s per-call timeout, not the 60 s platform limit
    expect(r.last.type).toBe("result"); // a closing event
    const res = r.result!;
    expect(scores(res)).toEqual(scores(r.probe)); // to 6 decimals
    expect(res.verdictLines![0]).toBe(r.probe.verdictLines![0]);
    expect(res.verdictLines![2]).toBe(r.probe.verdictLines![2]); // the fit line does not move
    expect(res.verdictLines![1]).toBe("Audience check incomplete: 1 of 6 comps had no estimate; the deck average uses the other 5 (Qloo's estimate).");
    expect(res.verdictLines![1]).not.toMatch(/no comp clearly stands apart|No audience outlier/);
    const w = res.comps.find((c) => c.match.input.title === "Winchester")!;
    expect(w.skewUnavailable).toBe(true);
    expect(w.skew?.female).toBeUndefined(); // nothing invented or carried over
    expect(w.skewFlag).toBeUndefined();
    expect(w.reasons.join(" ")).toContain("Audience estimate unavailable: no answer within 5 s.");
    expect(res.audience).toEqual({ attempted: 6, available: 5, unavailable: ["Winchester"] });
    expect(Object.values(w.audienceExport!).slice(0, 7)).toEqual(Array(7).fill("unavailable"));
    const md = toMarkdown(res), csv = toCsv(res);
    expect(md).toMatch(/\| Winchester \| unavailable \| unavailable \| unavailable \| unavailable \| unavailable \| unavailable \| unavailable \|/);
    expect(md).toContain("Audience check incomplete: 1 of 6 comps had no estimate (Winchester).");
    expect(md).toMatch(/This deck leans (young|older) overall \(based on 5 of 6 comps\)\./);
    expect(csv.split("\n").find((l) => l.startsWith('"Winchester (2018)'))).toContain('"unavailable","unavailable"');
    // The core result went out before the close, and nothing claimed a complete audience check.
    expect(r.events.some((e) => e.type === "core_result")).toBe(true);
  }, 30_000);

  it("a different comp times out and a flag remains: the 'among M of N' wording", async () => {
    const r = await cachedRun(hangFor("The Witch"));
    const res = r.result!;
    expect(scores(res)).toEqual(scores(r.probe));
    expect(res.verdictLines![1]).toMatch(/^Audience (outlier|split) among 5 of 6 comps: /);
    expect(res.verdictLines![1]).toContain("deck average over those 5");
    expect(res.verdictLines![1]).not.toMatch(/^Audience outlier: |^Audience split: /);
  }, 30_000);

  it("every call fails: the run still closes, all comps unavailable, scores unchanged", async () => {
    const r = await cachedRun((d) => ({ ...d, demographics: async () => { throw new Error("Qloo's monthly request limit is used up"); } }));
    const res = r.result!;
    expect(r.last.type).toBe("result");
    expect(scores(res)).toEqual(scores(r.probe));
    expect(res.verdictLines![1]).toBe("Audience check incomplete: 6 of 6 comps had no estimate.");
    expect(res.deckMean).toBeUndefined();
    expect(res.comps.every((c) => c.skewUnavailable && !c.skewFlag && !c.skewSplit)).toBe(true);
  }, 30_000);

  it("a call that ignores its timeout is cut by the skew budget", async () => {
    const r = await cachedRun((d, ids) => ({ ...d, skewLimits: { budgetMs: 300, callTimeoutMs: 60_000 }, demographics: (id, o) => (id === ids["Ma"] ? hang() : d.demographics(id, o)) }));
    expect(r.ms).toBeLessThan(5_000);
    const ma = r.result!.comps.find((c) => c.match.input.title === "Ma")!;
    expect(ma.skewUnavailable).toBe(true);
    expect(ma.skew?.error).toBe("audience time budget used up");
  }, 30_000);

  it("Run again with one incomplete run reports the audience part as not comparable", async () => {
    const full = (await cachedRun()).result!;
    const part = (await cachedRun(hangFor("Winchester"))).result!;
    const c = compareRuns(full, part);
    expect(c.fit).toBe("match");
    expect(c.audience).toBe(NOT_COMPARABLE);
    expect(c.line).toBe("Run again: fit scores match the previous run to 6 decimals; audience not comparable (audience check incomplete).");
    expect(compareRuns(full, full).line).toBe("Run again: fit scores match the previous run to 6 decimals; audience labels match.");
  }, 40_000);
});

describe("the stream always closes", () => {
  it("a run that never finishes and never reached the core: explicit error event at the deadline", async () => {
    const t0 = Date.now();
    const all = [];
    for await (const e of readEvents(checkEventStream(() => hang(), 6, 200))) all.push(e);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(all.map((e) => e.type)).toEqual(["start", "error"]);
  });
  it("a run that reached the core and then hangs: the core result closes the stream", async () => {
    const core = { comps: [], notes: [], qlooCalls: 0, cacheHits: 0, ranAt: "x" } as unknown as CheckResult;
    const all = [];
    for await (const e of readEvents(checkEventStream((on) => { on({ type: "core_result", result: core }); return hang(); }, 6, 200))) all.push(e);
    expect(all.map((e) => e.type)).toEqual(["start", "core_result", "result"]);
  });
});
