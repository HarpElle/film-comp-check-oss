/** Review fixes: a recorded Claude replay after Remove, the no-date status line in the removed state, and no "paused for today" in judge mode or on sample runs. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, setStoreForTests } from "@/lib/store";
import { K, kv } from "@/lib/kv";
import { resetSamplesForTests } from "@/lib/samples";
import { recordedStamp } from "@/lib/stamp";
import { showPausedToday } from "@/lib/paused-today";
import { PENNYWELL } from "@/lib/demo";
import { syntheticRecording } from "./fixtures/synthetic";
import type { AgentStep, CheckResult, CompInput } from "@/lib/types";

const removed = PENNYWELL[PENNYWELL.length - 1];
const rest = PENNYWELL.filter((c) => c !== removed);
const step = (reason: string) => [{ n: 1, action: "pageviews", reason, origin: "model" }, { n: 2, action: "finish", reason: "done", origin: "core" }] as unknown as AgentStep[];
const replay = (comps: CompInput[], reason: string, without?: string[]) => ({
  id: "pennywell", recordedAt: "2026-10-09T18:00:00.000Z", model: "m", without,
  result: { comps: comps.map((c, i) => ({ key: `c${i}`, match: { input: c, badge: "Matched", matchedTitle: c.title } })), steps: step(reason), provider: "claude", notes: [] },
});

describe("replay after Remove", () => {
  async function post(comps: unknown) {
    const { POST } = await import("@/app/api/check/route");
    const r = await POST(new Request("http://x/api/check", { method: "POST", headers: { "x-real-ip": "192.0.2.10" }, body: JSON.stringify({ comps }) }));
    return (await r.json()) as CheckResult & { error?: string };
  }
  beforeEach(async () => {
    setStoreForTests(new MemoryStore()); resetSamplesForTests();
    vi.stubEnv("AGENT_REPLAY", "1"); vi.stubEnv("QLOO_API_KEY", ""); vi.stubEnv("FIREWALL_RATE_LIMIT_ID", "");
    await kv().putSample(syntheticRecording("pennywell", "Pennywell", PENNYWELL));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("no network in this test"); });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setStoreForTests(undefined); resetSamplesForTests(); });

  it("is keyed by the removed titles, normalized and sorted, and never overwrites the full deck's replay", async () => {
    expect(K.replayWithout("pennywell", ["  The  Witch ", "Ma"])).toBe("sample:replay:pennywell:without:ma+the witch");
    expect(await kv().putReplay(replay(PENNYWELL, "full"))).toBe(true);
    expect(await kv().putReplay(replay(rest, "sub", [removed.title]))).toBe(true);
    expect((await kv().replay("pennywell"))?.result.steps?.[0].reason).toBe("full");
    expect((await kv().replay("pennywell", [removed.title.toUpperCase()]))?.without).toEqual([removed.title]);
  });
  it("judge mode serves the recorded Claude replay for that make-up instead of Template steps", async () => {
    await kv().putReplay(replay(PENNYWELL, "full"));
    await kv().putReplay(replay(rest, "sub", [removed.title]));
    const r = await post(rest);
    expect(r.error).toBeUndefined();
    expect(r.steps?.[0].reason).toBe("sub");
    expect(r.recorded?.replay).toBeDefined();
    expect(r.provider).toBe("claude");
  });
  it("a make-up with no replay of its own still falls back to Template steps", async () => {
    await kv().putReplay(replay(PENNYWELL, "full"));
    await kv().putReplay(replay(rest, "sub", [removed.title]));
    const other = PENNYWELL.slice(1);
    const r = await post(other);
    expect(r.error).toBeUndefined();
    expect(r.provider).toBe("template");
    expect(r.recorded?.replay).toBeUndefined();
  });
});

describe("removed state: no-date status line", () => {
  const steps = [{ n: 1, action: "resolve_comps", reason: "r", origin: "core" }, { n: 2, action: "pageviews", reason: "r", origin: "template" }, { n: 3, action: "finish", reason: "r", origin: "core" }] as unknown as AgentStep[];
  const r = { steps, provider: "template", recorded: { deck: "Pennywell", at: "2026-10-09T17:00:00.000Z" } } as unknown as CheckResult;
  it("drops the date only when asked", () => {
    const dated = recordedStamp(r)!, plain = recordedStamp(r, { date: false })!;
    expect(dated).toMatch(/^Qloo results recorded [A-Z][a-z]{2} \d{1,2}, \d{4} · Claude didn't run; Template steps 1 of 3$/);
    expect(plain).toBe("Qloo results recorded · Claude didn't run; Template steps 1 of 3");
    expect(recordedStamp(r, { date: false, steps: false })).toBe("Qloo results recorded");
    expect(plain).not.toMatch(/\d{4}/);
  });
});

describe("'Live checks are paused for today'", () => {
  it("is hidden in judge mode and on sample runs; shown only for a real visitor's own deck while paused", () => {
    expect(showPausedToday({ qlooLive: false, judge: true }, false)).toBe(false);
    expect(showPausedToday({ qlooLive: false, judge: true }, true)).toBe(false);
    expect(showPausedToday({ qlooLive: false, judge: false }, true)).toBe(false);
    expect(showPausedToday({ qlooLive: true, judge: false }, false)).toBe(false);
    expect(showPausedToday(undefined, false)).toBe(false);
    expect(showPausedToday({ qlooLive: false, judge: false }, false)).toBe(true);
  });
  it("/api/status says judge mode with no Qloo key or with live checks off", async () => {
    setStoreForTests(new MemoryStore());
    try {
      const { GET } = await import("@/app/api/status/route");
      vi.stubEnv("QLOO_API_KEY", ""); vi.stubEnv("QLOO_LIVE", "");
      expect(((await (await GET()).json()) as { judge: boolean }).judge).toBe(true);
      vi.stubEnv("QLOO_API_KEY", "test-key-not-real"); vi.stubEnv("QLOO_LIVE", "0");
      expect(((await (await GET()).json()) as { judge: boolean }).judge).toBe(true);
      vi.stubEnv("QLOO_LIVE", "");
      expect(((await (await GET()).json()) as { judge: boolean }).judge).toBe(false);
    } finally { vi.unstubAllEnvs(); setStoreForTests(undefined); }
  });
});
