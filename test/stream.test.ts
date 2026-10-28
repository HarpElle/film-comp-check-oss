import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkEventStream } from "@/lib/stream";
import { readEvents, type CheckEvent } from "@/lib/events";
import { runCheckWith } from "@/lib/check";
import { StubProvider } from "@/lib/agent";
import { cacheGet, cachePut } from "@/lib/cache";
import { QlooClient, type QlooEntity } from "@/lib/qloo";
import type { ToolDeps } from "@/lib/tools";
import type { CompInput } from "@/lib/types";

// Invented mock data only.
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
const opts = { provider: new StubProvider() };

async function collect(stream: ReadableStream<Uint8Array>): Promise<CheckEvent[]> {
  const out: CheckEvent[] = [];
  for await (const e of readEvents(stream)) out.push(e);
  return out;
}
// Wall-clock fields differ run to run; everything else must match.
const strip = <T extends { ranAt?: string; agentStats?: object }>(r: T) => ({ ...r, ranAt: "x", agentStats: r.agentStats && { ...r.agentStats, callMs: [], coreDoneMs: 0, totalMs: 0 } });

describe("check event stream", () => {
  it("emits start first, steps in order (started before done), result last", async () => {
    const events = await collect(checkEventStream((onEvent) => runCheckWith(INPUTS, deps, stats(), { ...opts, onEvent }), INPUTS.length));
    expect(events[0].type).toBe("start");
    expect(events.at(-1)!.type).toBe("result");
    const steps = events.filter((e): e is Extract<CheckEvent, { type: "step" }> => e.type === "step");
    // The first step event is the resolve step starting, before any tool output exists.
    expect(steps[0]).toMatchObject({ phase: "started", step: { n: 1, action: "resolve_comps" } });
    expect(steps[0].step.outcome).toBeUndefined();
    let lastN = 0;
    const started = new Set<number>();
    for (const e of steps) {
      expect(e.step.n).toBeGreaterThanOrEqual(lastN);
      lastN = e.step.n;
      if (e.phase === "started") started.add(e.step.n);
      else if (!e.step.rejected) expect(started.has(e.step.n)).toBe(true);
    }
    const result = (events.at(-1) as Extract<CheckEvent, { type: "result" }>).result;
    const done = steps.filter((e) => e.phase === "done").map((e) => e.step);
    expect(done).toEqual(result.steps);
  });

  it("final streamed result equals the non-streamed result", async () => {
    const plain = await runCheckWith(INPUTS, deps, stats(), opts);
    const events = await collect(checkEventStream((onEvent) => runCheckWith(INPUTS, deps, stats(), { ...opts, onEvent }), INPUTS.length));
    const streamed = (events.at(-1) as Extract<CheckEvent, { type: "result" }>).result;
    expect(strip(streamed)).toEqual(strip(JSON.parse(JSON.stringify(plain))));
    expect(streamed.verdictLines).toEqual(plain.verdictLines);
  });

  it("ends with an error event when the check throws", async () => {
    const events = await collect(checkEventStream(async () => { throw new Error("boom"); }, 3));
    expect(events.map((e) => e.type)).toEqual(["start", "error"]);
  });

  it("delivers the start line before the check finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stream = checkEventStream(async (onEvent) => { await gate; return runCheckWith(INPUTS, deps, stats(), { ...opts, onEvent }); }, 4);
    const it = readEvents(stream);
    const first = await it.next();
    expect(first.value).toMatchObject({ type: "start", comps: 4 });
    release();
    for await (const _ of it) { /* drain */ }
  });
});

describe("cache writes never break a run", () => {
  const saved = process.env.COMP_CACHE_DIR;
  afterEach(() => { process.env.COMP_CACHE_DIR = saved; vi.unstubAllGlobals(); });

  it("cachePut returns false instead of throwing when the cache dir is unusable", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-"));
    const file = path.join(dir, "not-a-dir");
    await fs.writeFile(file, "x");
    process.env.COMP_CACHE_DIR = path.join(file, "cache"); // a path under a regular file
    await expect(cachePut("https://example.test/a", { ok: 1 })).resolves.toBe(false);
    await expect(cacheGet("https://example.test/a")).resolves.toBeUndefined();
  });

  it("writes and reads under COMP_CACHE_DIR when it is usable", async () => {
    process.env.COMP_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "cc-"));
    await expect(cachePut("https://example.test/b", { ok: 2 })).resolves.toBe(true);
    await expect(cacheGet("https://example.test/b")).resolves.toEqual({ ok: 2 });
  });

  it("a Qloo call still succeeds when the cache write fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-"));
    await fs.writeFile(path.join(dir, "f"), "x");
    process.env.COMP_CACHE_DIR = path.join(dir, "f", "cache");
    const key = process.env.QLOO_API_KEY;
    process.env.QLOO_API_KEY = "placeholder";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [rec("Alpha", "A")] }), { status: 200 })));
    try {
      const q = new QlooClient({ minGapMs: 0 });
      await expect(q.searchMovies("Alpha")).resolves.toHaveLength(1);
      expect(q.stats.calls).toBe(1);
    } finally {
      if (key === undefined) delete process.env.QLOO_API_KEY; else process.env.QLOO_API_KEY = key;
    }
  });
});
