/** "Run live on Qloo" on the samples: slice accounting, per-visitor limit, gate states, the second-run rule, the date from the recording, and a whole run against a mocked Qloo with the in-memory store. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore, setStoreForTests } from "@/lib/store";
import { kv, ttlFor, TTL } from "@/lib/kv";
import { RESERVE, dailyCap, dayKey } from "@/lib/pacing";
import { SAMPLE_FLOOR, SAMPLE_SLICE, callsPerRun, sampleLiveEnabled, recordSampleLive, sampleGate, sampleGateFor, sliceAccrued, takeSampleDay, takeSampleVisitor, compareWithRecording } from "@/lib/live-sample";
import { fitDiffs, liveCompareLabel, liveCompareSummary } from "@/lib/compare";
import { stampDate } from "@/lib/stamp";
import { resetSamplesForTests } from "@/lib/samples";
import { SAMPLE_LIVE_OFF, SAMPLE_VISITOR_LIMIT, VISITOR_LIMIT } from "@/lib/messages";
import { toCsv, toMarkdown } from "@/lib/export";
import { PENNYWELL } from "@/lib/demo";
import type { CheckResult } from "@/lib/types";
import { syntheticRecording } from "./fixtures/synthetic";
// @ts-expect-error plain JS test helper
import { createMock, mockFetch } from "../e2e/mock-qloo.mjs";

// These tests exercise the gate with the samples' live run switched on; "SAMPLE_LIVE off" below covers the default.
process.env.SAMPLE_LIVE = "1";

const NOW = new Date("2026-11-04T18:00:00Z"); // Nov 4, Chicago: 27 days left
const req = (ip: string) => new Request("http://x/api/check", { method: "POST", headers: { "x-real-ip": ip } });
const thisMonth = (remaining: number) => ({ remaining, at: NOW.toISOString() });
const END16 = new Date("2026-11-16T18:00:00Z"); // the slice's last day: the whole 500 has accrued

describe("sample gate", () => {
  const base = { liveOn: true, quota: thisMonth(50_000), sliceUsed: 0, comps: 6, now: NOW, firstDay: "2026-10-20" };
  it("open: live, quota known this month, above the floor, slice left", () => {
    expect(sampleGate(base)).toMatchObject({ first: true, perRun: 24, sliceLeft: 500 });
  });
  it("closed with a reason: off, quota unknown, stale month, floor, slice", () => {
    expect(sampleGate({ ...base, liveOn: false })).toMatchObject({ first: false, second: false, why: "off" });
    expect(sampleGate({ ...base, quota: undefined })).toMatchObject({ first: false, why: "quota unknown" });
    expect(sampleGate({ ...base, quota: { remaining: 50_000, at: "2026-10-30T12:00:00Z" } })).toMatchObject({ first: false, why: "quota unknown" });
    expect(sampleGate({ ...base, quota: thisMonth(SAMPLE_FLOOR + 23) })).toMatchObject({ first: false, why: "floor" });
    expect(sampleGate({ ...base, quota: thisMonth(SAMPLE_FLOOR + 24) }).first).toBe(true); // the slice reaches into the reserve, down to the floor
    expect(sampleGate({ ...base, now: END16, sliceUsed: SAMPLE_SLICE - 23 })).toMatchObject({ first: false, why: "slice" });
    expect(sampleGate({ ...base, now: END16, sliceUsed: SAMPLE_SLICE - 24 }).first).toBe(true);
  });
  it("custom decks pause at the reserve; the sample slice still runs below it", () => {
    expect(SAMPLE_FLOOR).toBe(RESERVE - SAMPLE_SLICE);
    expect(sampleGate({ ...base, quota: thisMonth(RESERVE - 100) }).first).toBe(true);
  });
  it("second run: remaining - reserve covers the daily pace plus 2 runs, and the slice has 2 runs left", () => {
    const per = callsPerRun(6);
    // smallest remaining that passes, found from the rule itself
    let r = RESERVE; while (!(r - RESERVE >= dailyCap(r, NOW) + 2 * per)) r++;
    expect(sampleGate({ ...base, quota: thisMonth(r) }).second).toBe(true);
    expect(sampleGate({ ...base, quota: thisMonth(r - 1) }).second).toBe(false);
    expect(sampleGate({ ...base, quota: thisMonth(r - 1) }).first).toBe(true);
    expect(sampleGate({ ...base, now: END16, sliceUsed: SAMPLE_SLICE - 2 * per }).second).toBe(true);
    expect(sampleGate({ ...base, now: END16, sliceUsed: SAMPLE_SLICE - 2 * per + 1 }).second).toBe(false);
  });
});

describe("slice accounting and the per-visitor limit", () => {
  let db: ReturnType<typeof kv>;
  beforeEach(() => { db = kv(new MemoryStore(() => NOW.getTime())); });
  it("the month's slice counter adds the calls actually made; the gate follows it; the custom-deck pace is untouched", async () => {
    await db.putQuota(50_000, NOW.toISOString());
    await recordSampleLive(db, 17, 49_983, NOW);
    await recordSampleLive(db, 0, undefined, NOW);
    await recordSampleLive(db, 21, 49_962, NOW);
    expect(await db.sampleSliceUsed()).toBe(38);
    expect(await db.paceCount(dayKey(NOW))).toBe(0);
    expect((await db.quota())?.remaining).toBe(49_962);
    expect((await sampleGateFor(db, 6, NOW)).sliceLeft).toBe(SAMPLE_SLICE - 38);
    await recordSampleLive(db, SAMPLE_SLICE - 38 - 23, undefined, NOW); // 23 left < 24 for one run
    expect(await sampleGateFor(db, 6, NOW)).toMatchObject({ first: false, why: "slice" });
  });
  it("TTLs: slice counter and first day never expire, visitor key 48 h", async () => {
    expect(ttlFor("sample_live:slice")).toBeUndefined();
    expect(ttlFor("sample_live:first_day")).toBeUndefined();
    expect(ttlFor("sample_live:day:2026-10-20")).toBe(48 * 3_600);
    await db.bumpSampleSlice(5);
    expect(await db.store.ttl("sample_live:slice")).toBe(-1); // no expiry
    expect(ttlFor("sample_live:ip:2026-11-04:abc")).toBe(48 * 3_600);
    await db.bumpSampleLiveIp("2026-11-04", "abc");
    expect(await db.store.ttl("sample_live:ip:2026-11-04:abc")).toBe(48 * 3_600);
  });
  it("one live sample run per visitor per day; the second run is that visitor's second; separate from the custom-deck limit", async () => {
    expect(await takeSampleVisitor(db, req("1.1.1.1"), false, NOW)).toBe(true);
    expect(await takeSampleVisitor(db, req("1.1.1.1"), false, NOW)).toBe(false);
    expect(await takeSampleVisitor(db, req("2.2.2.2"), true, NOW)).toBe(false); // no second without a first
    expect(await takeSampleVisitor(db, req("3.3.3.3"), false, NOW)).toBe(true);
    expect(await takeSampleVisitor(db, req("3.3.3.3"), true, NOW)).toBe(true);
    expect(await takeSampleVisitor(db, req("3.3.3.3"), true, NOW)).toBe(false);
    expect(await takeSampleVisitor(db, req("4.4.4.4"), false, new Date(NOW.getTime() + 86_400_000))).toBe(true);
    expect(await db.ipCount(dayKey(NOW), "anything")).toBe(0);
    expect(SAMPLE_VISITOR_LIMIT).not.toBe(VISITOR_LIMIT);
  });
});

describe("comparison and its date", () => {
  const rec = syntheticRecording("pennywell", "Pennywell", PENNYWELL);
  const res = (fits: Record<string, number | undefined>) => ({ comps: PENNYWELL.map((c) => ({ match: { input: c }, fit: fits[c.title] === undefined ? undefined : { status: "Scored", affinity: fits[c.title] } })) }) as unknown as CheckResult;
  it("the date comes from the recording's recordedAt, never from code", () => {
    for (const at of ["2026-10-09T17:00:00.000Z", "2026-11-02T15:00:00.000Z"]) {
      const r = { ...rec, recordedAt: at };
      const c = compareWithRecording(res({}), r, PENNYWELL);
      expect(liveCompareLabel(c)).toBe(`Live run vs recording from ${stampDate(at)}. Qloo's data can change between them.`);
    }
    expect(liveCompareLabel({ kind: "live", againstAt: "x", rows: [] })).toBe("Second live run vs first live run (minutes apart).");
  });
  it("no literal recording date in the code (lib/, app/)", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const files = ["lib", "app"].flatMap((d) => walk(path.join(__dirname, "..", d))).filter((f) => /\.(ts|tsx)$/.test(f));
    const hits = files.filter((f) => /Oct 9/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("diffs at 3 on screen, 6 in export; matched means equal at 6 decimals", () => {
    const recorded = Object.fromEntries(PENNYWELL.map((c) => [c.title, Object.values(rec.fit)[0][c.title]]));
    const drift = { ...recorded, [PENNYWELL[2].title]: recorded[PENNYWELL[2].title]! + 0.0123 };
    const c = { kind: "recording" as const, againstAt: rec.recordedAt, rows: fitDiffs(res(drift), recorded) };
    expect(c.rows.filter((r) => r.same6).length).toBe(5);
    const d = c.rows.find((r) => !r.same6)!;
    expect(d.title).toBe(PENNYWELL[2].title);
    expect(liveCompareSummary(c, 3)).toContain(`Differs: ${PENNYWELL[2].title} (+0.012).`);
    expect(liveCompareSummary(c, 6)).toContain(`(+0.012300)`);
    expect(liveCompareSummary(c, 3)).toMatch(/^Matched to 6 decimals: /);
    const same = { kind: "recording" as const, againstAt: rec.recordedAt, rows: fitDiffs(res(recorded), recorded) };
    expect(liveCompareSummary(same)).toBe("All 6 fit scores matched to 6 decimals.");
    const tiny = { ...recorded, [PENNYWELL[0].title]: recorded[PENNYWELL[0].title]! + 0.000001 };
    expect(fitDiffs(res(tiny), recorded).filter((r) => !r.same6).map((r) => r.title)).toEqual([PENNYWELL[0].title]); // a 6th-decimal change is a difference
  });
});

describe("a live sample run through the route (mocked Qloo, in-memory store)", () => {
  const env = { ...process.env };
  let tmp: string, mock: ReturnType<typeof createMock>;
  const rec = syntheticRecording("pennywell", "Pennywell", PENNYWELL);
  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "live-sample-"));
    Object.assign(process.env, { QLOO_API_KEY: "test-key", QLOO_BASE_URL: "http://mock-qloo.test", QLOO_MIN_GAP_MS: "0", COMP_CACHE_DIR: tmp, AGENT_PROVIDER: "stub" });
    delete process.env.QLOO_LIVE; delete process.env.VERCEL;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-10T18:00:00Z")); // after the 1-a-day cap
    setStoreForTests(new MemoryStore()); resetSamplesForTests();
    await kv().putSample(rec);
    await kv().putSampleFirstDay("2026-10-20");
    await kv().putQuota(200_000, new Date().toISOString());
    mock = createMock([rec], { remaining: 200_000 });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch(mock));
  });
  afterEach(() => { process.env = { ...env }; setStoreForTests(undefined); resetSamplesForTests(); vi.restoreAllMocks(); vi.useRealTimers(); rmSync(tmp, { recursive: true, force: true }); });
  const post = async (body: unknown, ip = "9.9.9.9") => {
    const { POST } = await import("@/app/api/check/route");
    const r = await POST(new Request("http://x/api/check", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  it("live calls with the cache skipped, compared with the recording; the slice takes the calls made; a drift on one comp shows", async () => {
    mock.state.drift = { [PENNYWELL[1].title]: 0.0042 };
    const { status, body } = await post({ comps: PENNYWELL, live: "sample" });
    expect(status).toBe(200);
    const r = body as CheckResult;
    expect(r.recorded).toBeUndefined();
    expect(r.qlooCalls).toBe(mock.state.calls);
    expect(r.qlooCalls).toBeGreaterThan(0);
    expect(r.cacheHits).toBe(0);
    expect(r.provider).toBe("stub");
    const c = r.liveSample!.compare!;
    expect(liveCompareLabel(c)).toBe(`Live run vs recording from ${stampDate(rec.recordedAt)}. Qloo's data can change between them.`);
    expect(c.rows.filter((x) => !x.same6).map((x) => x.title)).toEqual([PENNYWELL[1].title]);
    expect(c.rows.find((x) => !x.same6)!.diff!.toFixed(6)).toBe("0.004200");
    expect(toMarkdown(r)).toContain("| 0.004200 | differs |");
    expect(toCsv(r)).toContain('"0.004200","differs"');
    expect(await kv().sampleSliceUsed()).toBe(r.qlooCalls);
    expect(await kv().paceCount(dayKey(new Date()))).toBe(0);
    expect((await kv().quota())!.remaining).toBe(mock.state.remaining);
    expect(await kv().comp(PENNYWELL)).toBeUndefined(); // not written to the custom-deck cache
    // the same visitor again: the per-visitor message; another visitor runs, identical case
    expect((await post({ comps: PENNYWELL, live: "sample" })).body.error).toBe(SAMPLE_VISITOR_LIMIT);
    mock.state.drift = {};
    const again = (await post({ comps: PENNYWELL, live: "sample" }, "8.8.8.8")).body as CheckResult;
    expect(liveCompareSummary(again.liveSample!.compare!)).toBe("All 6 fit scores matched to 6 decimals.");
  });
  it("SAMPLE_LIVE unset (the default): the gate reports disabled on an open quota, the route refuses, no Qloo call", async () => {
    delete process.env.SAMPLE_LIVE;
    expect(sampleLiveEnabled()).toBe(false);
    expect(await sampleGateFor(kv(), 6)).toMatchObject({ first: false, second: false, why: "disabled" });
    const { pageStatus } = await import("@/lib/status");
    const st = await pageStatus();
    expect(st.sampleLiveOn).toBe(false);
    expect(st.sampleLive?.pennywell).toEqual({ first: false, second: false });
    const { body } = await post({ comps: PENNYWELL, live: "sample" });
    expect(body.error).toBe(SAMPLE_LIVE_OFF);
    expect(mock.state.calls).toBe(0);
    for (const v of ["0", "true", "yes", ""]) { process.env.SAMPLE_LIVE = v; expect(sampleLiveEnabled()).toBe(false); }
    process.env.SAMPLE_LIVE = "1";
    expect(sampleLiveEnabled()).toBe(true);
    expect((await sampleGateFor(kv(), 6)).first).toBe(true);
  });
  it("gate closed: no live call at all", async () => {
    process.env.QLOO_LIVE = "0";
    const { body } = await post({ comps: PENNYWELL, live: "sample" });
    expect(body.error).toBe(SAMPLE_LIVE_OFF);
    expect(mock.state.calls).toBe(0);
  });
  it("not a sample deck: refused, no call", async () => {
    const { body } = await post({ comps: [{ title: "A" }, { title: "B" }, { title: "C" }], live: "sample" });
    expect(body.error).toMatch(/sample decks/);
    expect(mock.state.calls).toBe(0);
  });
});

describe("the slice through Nov 16: one key, linear accrual, whole runs, the 1-a-day cap", () => {
  const at = (d: string) => new Date(`${d}T18:00:00Z`); // noon-ish Chicago
  const q = (d: string) => ({ remaining: 50_000, at: at(d).toISOString() });
  const gate = (d: string, o: Partial<Parameters<typeof sampleGate>[0]> = {}) => sampleGate({ liveOn: true, quota: q(d), sliceUsed: 0, comps: 6, now: at(d), firstDay: "2026-10-12", ...o });
  it("accrual: 500 * days elapsed / total days, both inclusive of the first available day", () => {
    expect(sliceAccrued("2026-10-12", "2026-10-12")).toBe(Math.floor(500 / 36)); // 36 days Oct 12..Nov 16
    expect(sliceAccrued("2026-10-12", "2026-10-13")).toBe(Math.floor(1000 / 36));
    expect(sliceAccrued("2026-10-12", "2026-11-16")).toBe(500);
    expect(sliceAccrued("2026-10-12", "2026-12-01")).toBe(500);
    expect(sliceAccrued("2026-11-10", "2026-11-10")).toBe(Math.floor(500 / 7));
  });
  it("whole-run unlock: day 1 (13 calls) has no run; day 2 (27) unlocks one Pennywell run; Dream Hackers (20) needs 20", () => {
    expect(gate("2026-10-12")).toMatchObject({ first: false, why: "slice", runsAvailable: 0 });
    expect(gate("2026-10-13")).toMatchObject({ first: true, runsAvailable: 1 });
    expect(gate("2026-10-12", { comps: 5 }).first).toBe(false); // 13 < 20
    expect(gate("2026-10-13", { comps: 5 }).first).toBe(true); // 27 >= 20
    expect(gate("2026-10-13", { sliceUsed: 24 }).first).toBe(false); // used the accrued run already
  });
  it("first available day is recorded once, from the first valid quota reading above the floor", async () => {
    const db = kv(new MemoryStore(() => at("2026-10-12").getTime()));
    await sampleGateFor(db, 6, at("2026-10-12"));
    expect(await db.sampleFirstDay()).toBeUndefined(); // no quota reading: not available yet
    await db.putQuota(SAMPLE_FLOOR + 10, at("2026-10-14").toISOString());
    await sampleGateFor(db, 6, at("2026-10-14"));
    expect(await db.sampleFirstDay()).toBeUndefined(); // below the floor
    await db.putQuota(50_000, at("2026-10-15").toISOString());
    expect((await sampleGateFor(db, 6, at("2026-10-15"))).firstDay).toBe("2026-10-15");
    await db.putQuota(50_000, at("2026-10-20").toISOString());
    expect((await sampleGateFor(db, 6, at("2026-10-20"))).firstDay).toBe("2026-10-15"); // kept
    expect(await db.putSampleFirstDay("2026-10-21")).toBe("2026-10-15");
  });
  it("no reset across Nov 1 and Nov 6: the same key keeps counting, the allowance does not jump", async () => {
    const db = kv(new MemoryStore(() => at("2026-10-31").getTime()));
    await db.putSampleFirstDay("2026-10-12");
    await recordSampleLive(db, 200, 60_000, at("2026-10-31"));
    await recordSampleLive(db, 50, 40_000, at("2026-11-02")); // a new month
    await db.putQuota(200_000, at("2026-11-06").toISOString()); // Qloo's quota resets
    await recordSampleLive(db, 30, 199_970, at("2026-11-07"));
    expect(await db.sampleSliceUsed()).toBe(280);
    const g = await sampleGateFor(db, 6, at("2026-11-07"));
    expect(g.sliceLeft).toBe(220);
    expect(g.runsAvailable).toBe(Math.floor((sliceAccrued("2026-10-12", "2026-11-07") - 280) / 24));
    expect(await db.store.ttl("sample_live:slice")).toBe(-1);
  });
  it("1 run a day across all visitors through Nov 1 (no second run); lifted Nov 2", async () => {
    expect(gate("2026-11-01", { runsToday: 0 })).toMatchObject({ first: true, second: false });
    expect(gate("2026-11-01", { runsToday: 1 })).toMatchObject({ first: false, why: "today" });
    expect(gate("2026-11-02", { runsToday: 1 }).first).toBe(true);
    expect(gate("2026-11-02", { runsToday: 3 }).second).toBe(true);
    const db = kv(new MemoryStore(() => at("2026-11-01").getTime()));
    expect(await takeSampleDay(db, at("2026-11-01"))).toBe(true);
    expect(await takeSampleDay(db, at("2026-11-01"))).toBe(false);
    expect(await db.store.ttl("sample_live:day:2026-11-01")).toBe(48 * 3_600);
    expect(await takeSampleDay(db, at("2026-11-02"))).toBe(true);
    expect(await takeSampleDay(db, at("2026-11-02"))).toBe(true);
  });
  it("closed after Nov 16, and the total never exceeds 500 however the days run", () => {
    expect(gate("2026-11-17")).toMatchObject({ first: false, why: "ended" });
    let used = 0;
    for (let t = at("2026-10-12").getTime(); t <= at("2026-11-16").getTime(); t += 86_400_000) {
      const d = dayKey(new Date(t));
      for (let k = 0; k < 40; k++) { // greedy: take every run the gate allows, worst case per run
        const g = gate(d, { sliceUsed: used, runsToday: k });
        if (!g.first) break;
        used += g.perRun;
      }
      expect(used).toBeLessThanOrEqual(sliceAccrued("2026-10-12", d));
    }
    expect(used).toBeLessThanOrEqual(500);
    expect(used).toBeGreaterThan(500 - 24);
  });
});
