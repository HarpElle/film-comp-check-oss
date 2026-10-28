/** Store adapters, the trim whitelist, TTL policy per key prefix, pacing math, the per-visitor limit, mode switching. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileStore, MemoryStore, UpstashStore, getStore, memorySeedPath, setStoreForTests, upstashEnv, type Store } from "@/lib/store";
import { K, kv, TTL, ttlFor } from "@/lib/kv";
import { MAX_ENTRY_BYTES, trimRecording } from "@/lib/trim";
import { dailyCap, daysLeftInMonth, dayKey, ipHash, liveMode, maybeProbeQuota, recordLive, RESERVE, takeVisitorCheck, PAUSED_QUOTA, PAUSED_TODAY } from "@/lib/pacing";
import { VISITOR_LIMIT } from "@/lib/messages";
import { resetSamplesForTests } from "@/lib/samples";
import { PENNYWELL } from "@/lib/demo";
import { syntheticRecording } from "./fixtures/synthetic";
import { seed } from "../scripts/lib/seed";

/** Wraps a store and records every set (key, ttl) and incr (key, ttl). */
function spying(inner: Store) {
  const sets: { key: string; ttlSec?: number }[] = [], incrs: { key: string; ttlSec?: number }[] = [];
  const s: Store = {
    kind: inner.kind,
    get: (k) => inner.get(k), mget: (k) => inner.mget(k), ttl: (k) => inner.ttl(k),
    set: async (k, v, o) => { sets.push({ key: k, ttlSec: o?.ttlSec }); return inner.set(k, v, o); },
    incr: async (k, o) => { incrs.push({ key: k, ttlSec: o.ttlSec }); return inner.incr(k, o); },
  };
  return { s, sets, incrs };
}

describe("adapters", () => {
  for (const make of [
    ["memory", (now: () => number) => new MemoryStore(now)],
    ["file", (now: () => number) => new FileStore(mkdtempSync(path.join(os.tmpdir(), "fcc-store-")), now)],
  ] as const) {
    it(`${make[0]}: get/set/mget, expiry, incr keeps its first expiry`, async () => {
      let t = 1_000_000;
      const st = make[1](() => t);
      await st.set("a", { x: 1 });
      await st.set("b", [2], { ttlSec: 10 });
      expect(await st.get("a")).toEqual({ x: 1 });
      expect(await st.mget(["a", "b", "c"])).toEqual([{ x: 1 }, [2], undefined]);
      expect(await st.ttl("a")).toBe(-1);
      expect(await st.ttl("b")).toBe(10);
      expect(await st.ttl("c")).toBe(-2);
      expect(await st.incr("n", { ttlSec: 5 })).toBe(1);
      t += 3000;
      expect(await st.incr("n", { ttlSec: 5, by: 4 })).toBe(5);
      expect(await st.ttl("n")).toBe(2); // not extended by the second incr
      t += 10_001;
      expect(await st.get("b")).toBeUndefined();
      expect(await st.get("n")).toBeUndefined();
      expect(await st.get("a")).toEqual({ x: 1 });
    });
  }
  it("upstash: REST calls with EX only when a TTL is given; incr + EXPIRE NX in one pipeline (mocked fetch)", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      calls.push({ url: String(u), body });
      const result = String(u).endsWith("/pipeline") ? [{ result: 3 }, { result: 1 }] : { result: Array.isArray(body) && body[0] === "get" ? JSON.stringify({ a: 1 }) : "OK" };
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    });
    const st = new UpstashStore("https://example-redis.upstash.io", "tok-not-real");
    await st.set("sample:deck:x", { a: 1 });
    await st.set("comp:abc", { a: 1 }, { ttlSec: TTL.comp });
    expect(await st.get("sample:deck:x")).toEqual({ a: 1 });
    expect(await st.incr("ip:2026-10-09:h", { ttlSec: TTL.ip })).toBe(3);
    const cmd = calls.map((c) => c.body as unknown[]);
    expect(cmd[0].map(String).map((x) => x.toLowerCase())).toEqual(["set", "sample:deck:x", '{"a":1}']);
    expect(cmd[1].map(String).map((x) => x.toLowerCase())).toEqual(["set", "comp:abc", '{"a":1}', "ex", String(TTL.comp)]);
    expect(calls[3].url).toMatch(/\/pipeline$/);
    expect((cmd[3] as unknown[][]).map((c) => c.map(String).map((x) => x.toLowerCase()))).toEqual([["incrby", "ip:2026-10-09:h", "1"], ["expire", "ip:2026-10-09:h", String(TTL.ip), "nx"]]);
    vi.restoreAllMocks();
  });
  it("env pairs: UPSTASH_* or KV_REST_API_*, UPSTASH_* preferred, read-only token never used, half pairs ignored", () => {
    const U = { VERCEL: "1", UPSTASH_REDIS_REST_URL: "https://u.upstash.io", UPSTASH_REDIS_REST_TOKEN: "u-tok" };
    const V = { VERCEL: "1", KV_REST_API_URL: "https://v.upstash.io", KV_REST_API_TOKEN: "v-tok", KV_REST_API_READ_ONLY_TOKEN: "ro-tok" };
    expect(upstashEnv({ ...U })).toEqual({ url: U.UPSTASH_REDIS_REST_URL, token: "u-tok", source: "UPSTASH_REDIS_REST" });
    expect(upstashEnv({ ...V })).toEqual({ url: V.KV_REST_API_URL, token: "v-tok", source: "KV_REST_API" });
    expect(upstashEnv({ ...U, ...V })?.source).toBe("UPSTASH_REDIS_REST");
    expect(upstashEnv({ VERCEL: "1", KV_REST_API_URL: V.KV_REST_API_URL, KV_REST_API_READ_ONLY_TOKEN: "ro-tok" })).toBeUndefined();
    expect(upstashEnv({ UPSTASH_REDIS_REST_URL: U.UPSTASH_REDIS_REST_URL, ...V })?.source).toBe("KV_REST_API"); // half UPSTASH pair: the full KV pair is used
    expect(upstashEnv({ UPSTASH_REDIS_REST_TOKEN: "u-tok", KV_REST_API_URL: V.KV_REST_API_URL })).toBeUndefined();
    expect(upstashEnv({})).toBeUndefined();
    // Off Vercel the shared store is opt-in: an inherited KV pair alone is ignored (local tests can't touch production).
    const { VERCEL: _v, ...offV } = V;
    expect(upstashEnv(offV)).toBeUndefined();
    expect(upstashEnv({ ...offV, SHARED_STORE: "1" })?.source).toBe("KV_REST_API");
  });
  it("getStore with the KV_REST_API_* pair: Upstash, and requests go to that URL with the read-write token", async () => {
    const env = { ...process.env };
    const seen: { url: string; auth: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
      seen.push({ url: String(u), auth: new Headers((init as RequestInit).headers).get("authorization") });
      return new Response(JSON.stringify({ result: "OK" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "STORE_FILE_DIR"]) delete process.env[k];
      process.env.SHARED_STORE = "1";
      Object.assign(process.env, { KV_REST_API_URL: "https://v.upstash.io", KV_REST_API_TOKEN: "v-tok", KV_REST_API_READ_ONLY_TOKEN: "ro-tok" });
      setStoreForTests(undefined);
      const st = getStore() as UpstashStore;
      expect(st.kind).toBe("upstash"); expect(st.source).toBe("KV_REST_API");
      await st.set("sample:x", 1);
      expect(seen[0].url.startsWith("https://v.upstash.io")).toBe(true);
      expect(seen[0].auth).toBe("Bearer v-tok");
      Object.assign(process.env, { UPSTASH_REDIS_REST_URL: "https://u.upstash.io", UPSTASH_REDIS_REST_TOKEN: "u-tok" });
      setStoreForTests(undefined);
      const st2 = getStore() as UpstashStore;
      expect(st2.source).toBe("UPSTASH_REDIS_REST");
      await st2.set("sample:x", 1);
      expect(seen[1].url.startsWith("https://u.upstash.io")).toBe(true);
      expect(seen[1].auth).toBe("Bearer u-tok");
    } finally { process.env = env; setStoreForTests(undefined); vi.restoreAllMocks(); }
  });
  it("getStore: Upstash only when an env pair is set; else file when STORE_FILE_DIR; else memory", () => {
    const env = { ...process.env };
    try {
      for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
      process.env.SHARED_STORE = "1";
      setStoreForTests(undefined); delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.STORE_FILE_DIR;
      expect(getStore().kind).toBe("memory");
      setStoreForTests(undefined); process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io"; expect(getStore().kind).toBe("memory");
      setStoreForTests(undefined); process.env.UPSTASH_REDIS_REST_TOKEN = "t"; expect(getStore().kind).toBe("upstash");
      setStoreForTests(undefined); delete process.env.UPSTASH_REDIS_REST_URL; process.env.STORE_FILE_DIR = os.tmpdir(); expect(getStore().kind).toBe("file");
    } finally { process.env = env; setStoreForTests(undefined); }
  });
});

describe("trim", () => {
  it("a raw Qloo-shaped object passed in is stored trimmed (whitelisted fields only)", async () => {
    const st = new MemoryStore();
    const rec = syntheticRecording("t", "Testdeck", [{ title: "Alpha Film", year: 2001 }, { title: "Beta Film", year: 2002 }, { title: "Gamma Film", year: 2003 }]) as unknown as Record<string, unknown>;
    const raw = {
      ...rec, results: { entities: [{ entity_id: "ENTITY-RAW", properties: { description: "long text" }, tags: [{ tag_id: "urn:tag:x", name: "x" }] }] },
      comps: (rec.comps as Record<string, unknown>[]).map((c) => ({ ...c, entity_id: "ENTITY-RAW", properties: { description: "raw" }, match: { ...(c.match as object), entityId: "ENTITY-RAW", recordTags: [{ name: "x", tagId: "urn:tag:x", type: "genre" }], popularity: 0.5 }, query: { affinity: 0.1 } })),
    };
    await kv(st).putSample(raw);
    const stored = JSON.stringify(await st.get(K.sample("t")));
    expect(stored).not.toMatch(/ENTITY-RAW|urn:tag|properties|description|recordTags|entityId|popularity|"query"|"results"/);
    expect(await st.get(K.sample("t"))).toEqual(trimRecording(rec));
  });
  it("entries over the size limit are refused (nothing written)", async () => {
    const st = new MemoryStore();
    const big = syntheticRecording("big", "Big", Array.from({ length: 10 }, (_, i) => ({ title: `Film ${i} ${"x".repeat(190)}` })));
    for (const c of big.comps) c.tagLooks = Object.fromEntries(Array.from({ length: 64 }, (_, j) => [`${j}${"k".repeat(1990)}`, { totalTags: 1, sharedWithDeck: 1, uniqueCount: 0 }]));
    expect(await kv(st).putSample(big)).toBe(false);
    expect(await st.get(K.sample("big"))).toBeUndefined();
    const ok = syntheticRecording("ok", "Ok", PENNYWELL);
    expect(Buffer.byteLength(JSON.stringify(trimRecording(ok)))).toBeLessThan(MAX_ENTRY_BYTES);
    expect(await kv(st).putSample(ok)).toBe(true);
  });
  it("a custom comp list stores comp titles plus trimmed Qloo fields: no year, director, deck name or deck text", async () => {
    const st = new MemoryStore();
    const comps = [{ title: "Alpha Film", year: 2001, director: "Pat Example" }, { title: "Beta Film", year: 2002, director: "Sam Sample" }, { title: "Gamma Film", year: 2003 }];
    const base = syntheticRecording("x", "My Secret Film Title", comps);
    for (const c of base.comps) if (c.match.directorInRecord) c.match.directorInRecord = "Record Credit"; // the record's own credit (a Qloo field) is kept
    const rec = { ...base, deckText: "My Secret Film Title logline" };
    await kv(st).putComp(comps, rec);
    const stored = (await st.get(K.comp(comps)))!;
    const s = JSON.stringify(stored);
    expect(s).not.toMatch(/My Secret Film|logline|Pat Example|Sam Sample|"year"|"director"/);
    expect(s).toMatch(/Alpha Film/);
    expect(K.comp(comps)).toMatch(/^comp:[0-9a-f]{40}$/); // the key itself holds no titles
  });
});

describe("TTL per key type", () => {
  it("policy: sample keys none; comp 30 days; hashed IP 48 h; pace 48 h", () => {
    expect(ttlFor("sample:deck:x")).toBeUndefined();
    expect(ttlFor("sample:index")).toBeUndefined();
    expect(ttlFor("sample:landing")).toBeUndefined();
    expect(ttlFor("comp:abc")).toBe(30 * 86_400);
    expect(ttlFor("ip:2026-10-09:abc")).toBe(48 * 3_600);
    expect(ttlFor("pace:2026-10-09")).toBe(48 * 3_600);
    expect(() => ttlFor("other:x")).toThrow();
  });
  it("writes to sample keys never set a TTL (samples, index, replay, landing)", async () => {
    const { s, sets } = spying(new MemoryStore());
    const db = kv(s);
    await db.putSample(syntheticRecording("a", "A", PENNYWELL));
    await db.putReplay({ id: "a", recordedAt: "2026-10-09T17:00:00.000Z", model: "m", result: { comps: [] } });
    await db.putLanding({ deck: "A", comps: 6, verdictLines: ["x"] });
    expect(sets.length).toBe(4);
    for (const w of sets) { expect(w.key.startsWith("sample:")).toBe(true); expect(w.ttlSec).toBeUndefined(); expect(await s.ttl(w.key)).toBe(-1); }
  });
  it("the seeding script never sets a TTL", async () => {
    const { s, sets, incrs } = spying(new MemoryStore());
    setStoreForTests(s); resetSamplesForTests();
    try {
      const log = await seed(kv(s), [syntheticRecording("pennywell", "Pennywell", PENNYWELL)], { replay: { id: "pennywell", recordedAt: "2026-10-09T17:00:00.000Z", result: { comps: [] } } });
      expect(log.join("\n")).not.toMatch(/REFUSED/);
      expect(sets.map((w) => w.key).sort()).toEqual(["sample:deck:pennywell", "sample:index", "sample:landing", "sample:replay:pennywell"]);
      expect(sets.every((w) => w.ttlSec === undefined)).toBe(true);
      expect(incrs).toEqual([]);
      for (const k of sets.map((w) => w.key)) expect(await s.ttl(k)).toBe(-1);
    } finally { setStoreForTests(undefined); resetSamplesForTests(); }
  });
  it("comp-list entries expire after 30 days", async () => {
    let t = 0;
    const st = new MemoryStore(() => t);
    const comps = PENNYWELL.slice(0, 3);
    await kv(st).putComp(comps, syntheticRecording("x", "", comps));
    expect(await st.ttl(K.comp(comps))).toBe(30 * 86_400);
    t = 30 * 86_400 * 1000 - 1; expect(await kv(st).comp(comps)).toBeDefined();
    t = 30 * 86_400 * 1000; expect(await kv(st).comp(comps)).toBeUndefined();
  });
  it("hashed IP keys expire after 48 hours and hold no IP", async () => {
    let t = Date.parse("2026-10-09T15:00:00Z");
    const { s, incrs } = spying(new MemoryStore(() => t));
    const req = new Request("http://x/api/check", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    await takeVisitorCheck(kv(s), req, new Date(t));
    expect(incrs).toHaveLength(1);
    expect(incrs[0].ttlSec).toBe(48 * 3_600);
    expect(incrs[0].key).toBe(`ip:2026-10-09:${ipHash("203.0.113.7")}`);
    expect(incrs[0].key).not.toContain("203.0.113");
    expect(await s.ttl(incrs[0].key)).toBe(48 * 3_600);
    t += 48 * 3_600 * 1000; expect(await s.get(incrs[0].key)).toBeUndefined();
  });
  it("pace counters expire after 48 hours", async () => {
    const { s, incrs } = spying(new MemoryStore());
    await recordLive(kv(s), 12, 5000, new Date("2026-10-09T15:00:00Z"));
    expect(incrs).toEqual([{ key: "pace:2026-10-09", ttlSec: 48 * 3_600 }]);
  });
});

describe("pacing", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("days left and the daily cap", () => {
    expect(daysLeftInMonth(new Date("2026-10-09T15:00:00Z"))).toBe(23); // Oct 9..31
    expect(daysLeftInMonth(new Date("2026-11-01T03:00:00Z"))).toBe(1); // still Oct 31 in Chicago
    expect(daysLeftInMonth(new Date("2026-11-16T18:00:00Z"))).toBe(15);
    expect(dailyCap(5600, new Date("2026-10-09T15:00:00Z"))).toBe(200); // (5600 - 1000) / 23
    expect(dailyCap(900, new Date("2026-10-09T15:00:00Z"))).toBe(0);
    expect(RESERVE).toBe(1000);
    expect(dayKey(new Date("2026-10-10T03:30:00Z"))).toBe("2026-10-09");
  });
  it("live with no reading; paused for quota at or under the reserve; paced after today's share; back to live when a response shows quota", async () => {
    const db = kv(new MemoryStore());
    const now = new Date("2026-10-09T15:00:00Z");
    expect((await liveMode(db, now)).mode).toBe("live");
    await recordLive(db, 30, 1000, now);
    expect(await liveMode(db, now)).toMatchObject({ mode: "recorded", reason: "quota", message: PAUSED_QUOTA });
    // A live response that shows quota remaining switches back.
    await recordLive(db, 0, 1000 + 23 * 10 + 20, now); // start of day = remaining + 30 used = 1280 -> cap 12; used 30 -> paced
    expect(await liveMode(db, now)).toMatchObject({ mode: "recorded", reason: "paced", message: PAUSED_TODAY, cap: 12 });
    expect((await liveMode(db, new Date("2026-10-10T15:00:00Z"))).mode).toBe("live"); // a new day: the counter starts over
    await recordLive(db, 0, 9000, now);
    expect((await liveMode(db, now)).mode).toBe("live");
    await recordLive(db, 0, 0, now);
    expect((await liveMode(db, new Date("2026-11-01T15:00:00Z"))).mode).toBe("live"); // a new month: the old reading is stale
    vi.stubEnv("QLOO_LIVE", "0");
    expect((await liveMode(db, now)).mode).toBe("recorded");
  });
  it("while paused for quota: one probe an hour; a probe that shows quota switches back to live", async () => {
    const db = kv(new MemoryStore());
    const t0 = new Date("2026-10-09T15:00:00Z");
    await recordLive(db, 0, 0, t0);
    const probe = vi.fn(async () => 4000);
    expect(await maybeProbeQuota(db, probe, new Date(t0.getTime() + 30 * 60_000))).toBe(false);
    expect(await maybeProbeQuota(db, async () => 0, new Date(t0.getTime() + 61 * 60_000))).toBe(true);
    expect(await maybeProbeQuota(db, probe, new Date(t0.getTime() + 90 * 60_000))).toBe(false);
    expect(await maybeProbeQuota(db, probe, new Date(t0.getTime() + 125 * 60_000))).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect((await liveMode(db, new Date(t0.getTime() + 125 * 60_000))).mode).toBe("live");
  });
  it("per-visitor daily limit counts by hashed IP; other visitors and the next day are separate", async () => {
    vi.stubEnv("IP_DAILY_LIVE_CHECKS", "2");
    const db = kv(new MemoryStore());
    const a = new Request("http://x", { headers: { "x-real-ip": "198.51.100.1" } }), b = new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } });
    const d1 = new Date("2026-10-09T15:00:00Z"), d2 = new Date("2026-10-10T15:00:00Z");
    expect([await takeVisitorCheck(db, a, d1), await takeVisitorCheck(db, a, d1), await takeVisitorCheck(db, a, d1)]).toEqual([true, true, false]);
    expect(await takeVisitorCheck(db, b, d1)).toBe(true);
    expect(await takeVisitorCheck(db, a, d2)).toBe(true);
  });
});

describe("mode switching in /api/check (no Qloo call)", () => {
  let fetchSpy: import("vitest").MockInstance<typeof fetch>;
  const custom = [{ title: "Alpha Film", year: 2001 }, { title: "Beta Film", year: 2002 }, { title: "Gamma Film", year: 2003 }];
  async function post(comps: unknown, ip = "192.0.2.10") {
    const { POST } = await import("@/app/api/check/route");
    const r = await POST(new Request("http://x/api/check", { method: "POST", headers: { "x-real-ip": ip }, body: JSON.stringify({ comps }) }));
    return (await r.json()) as { error?: string; recorded?: unknown; qlooCalls?: number };
  }
  beforeEach(async () => {
    setStoreForTests(new MemoryStore()); resetSamplesForTests();
    vi.stubEnv("AGENT_PROVIDER", "stub"); vi.stubEnv("QLOO_API_KEY", ""); vi.stubEnv("FIREWALL_RATE_LIMIT_ID", "");
    await kv().putSample(syntheticRecording("pennywell", "Pennywell", PENNYWELL));
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("no network in this test"); });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setStoreForTests(undefined); resetSamplesForTests(); });
  it("a sample deck runs from its recording", async () => {
    const r = await post(PENNYWELL);
    expect(r.recorded).toBeDefined(); expect(r.qlooCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("a custom deck recorded in the last 30 days runs from the store", async () => {
    await kv().putComp(custom, syntheticRecording("x", "", custom));
    const r = await post(custom);
    expect(r.recorded).toBeDefined(); expect(r.qlooCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("quota at the reserve: a custom deck gets the paused message", async () => {
    await kv().putQuota(RESERVE, new Date().toISOString());
    expect((await post(custom)).error).toBe(PAUSED_QUOTA);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("over the visitor's daily limit: the visitor-limit message, before any Qloo call", async () => {
    vi.stubEnv("IP_DAILY_LIVE_CHECKS", "0");
    expect((await post(custom)).error).toBe(VISITOR_LIMIT);
    expect(VISITOR_LIMIT).toBe("You've used today's live checks. The sample decks still run.");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await post(PENNYWELL)).recorded).toBeDefined(); // samples still run
  });
});

describe("recording a run for the comp-list cache", () => {
  it("a run recorded through recordingDeps replays to the same result (round trip through trim)", async () => {
    const { recordingDeps } = await import("@/lib/record");
    const { runAgent, StubProvider } = await import("@/lib/agent");
    const { runCheckWith } = await import("@/lib/check");
    const { sampleDeps } = await import("@/lib/samples");
    const comps = [{ title: "Alpha Film", year: 2001 }, { title: "Beta Film", year: 2002 }, { title: "Gamma Film", year: 2003 }, { title: "Delta Film", year: 2004 }];
    const src = syntheticRecording("src", "", comps);
    const rec = recordingDeps(sampleDeps(src));
    const run = await runAgent(comps, rec.deps, new StubProvider());
    const built = rec.build(run, "2026-10-09T18:00:00.000Z")!;
    const st = new MemoryStore();
    await kv(st).putComp(comps, built);
    const back = (await kv(st).comp(comps))!;
    const pick = (r: Awaited<ReturnType<typeof runCheckWith>>) => ({ v: r.verdictLines, rows: r.comps.map((c) => [c.fit?.affinity, c.skew?.female, c.skew?.age, c.views?.views, c.rank]) });
    const a = await runCheckWith(comps, sampleDeps(src), { calls: 0, cacheHits: 0 }, { provider: new StubProvider() });
    const b = await runCheckWith(comps, sampleDeps({ ...back, comps: back.comps.map((c, i) => ({ ...c, input: comps[i] })) }), { calls: 0, cacheHits: 0 }, { provider: new StubProvider() });
    expect(pick(b)).toEqual(pick(a));
  });
});

describe("MEMORY_STORE_SEED is test-only", () => {
  const seedEnv = { MEMORY_STORE_SEED: "/tmp/seed.json" };
  it("is used off Vercel with no Upstash pair", () => {
    expect(memorySeedPath(seedEnv)).toBe("/tmp/seed.json");
  });
  it("is ignored when an UPSTASH_REDIS_REST pair is set", () => {
    expect(memorySeedPath({ ...seedEnv, SHARED_STORE: "1", UPSTASH_REDIS_REST_URL: "https://x.example", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeUndefined();
  });
  it("is ignored when a KV_REST_API pair is set", () => {
    expect(memorySeedPath({ ...seedEnv, SHARED_STORE: "1", KV_REST_API_URL: "https://x.example", KV_REST_API_TOKEN: "t" })).toBeUndefined();
  });
  it("is ignored on Vercel", () => {
    expect(memorySeedPath({ ...seedEnv, VERCEL: "1" })).toBeUndefined();
  });
  it("still applies when only half a pair is set (no Upstash store)", () => {
    expect(memorySeedPath({ ...seedEnv, KV_REST_API_URL: "https://x.example" })).toBe("/tmp/seed.json");
  });
  it("getStore uses Upstash, not the seed, when both are configured", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubEnv("SHARED_STORE", "1");
    vi.stubEnv("MEMORY_STORE_SEED", "/nonexistent/seed.json");
    setStoreForTests(undefined);
    try { expect(getStore()).toBeInstanceOf(UpstashStore); }
    finally { setStoreForTests(undefined); vi.unstubAllEnvs(); }
  });
});

describe("synthetic samples never reach production", () => {
  it("a shared (Upstash-kind) store refuses synthetic recordings and hides any already there", async () => {
    const { kv, isSyntheticRecording } = await import("@/lib/kv");
    const { MemoryStore } = await import("@/lib/store");
    const { syntheticRecording } = await import("./fixtures/synthetic");
    const { PENNYWELL } = await import("@/lib/demo");
    const rec = syntheticRecording("pennywell", "Pennywell", PENNYWELL);
    expect(isSyntheticRecording(rec)).toBe(true);
    const shared = new MemoryStore();
    Object.defineProperty(shared, "kind", { value: "upstash" });
    expect(await kv(shared).putSample(rec)).toBe(false);
    // Already present (written before the guard): not served, and the landing snippet is withheld.
    const local = new MemoryStore();
    expect(await kv(local).putSample(rec)).toBe(true);
    await kv(local).putLanding({ deck: "Pennywell", comps: 6, verdictLines: ["x"], recordedAt: rec.recordedAt });
    shared.load(local.dump());
    expect(await kv(shared).samples()).toEqual([]);
    expect(await kv(shared).sampleIndex()).toEqual([]);
    expect(await kv(shared).landing()).toBeUndefined();
    expect((await kv(local).samples()).length).toBe(1);
  });
  it("a shared (Upstash-kind) store refuses synthetic replays (flag or marker) and hides any already there", async () => {
    const { kv, isSyntheticReplay, SYNTHETIC_MARK } = await import("@/lib/kv");
    const { MemoryStore } = await import("@/lib/store");
    const flagged = { id: "pennywell", recordedAt: "2026-10-09T17:00:00.000Z", model: "m", synthetic: true, result: { comps: [] } };
    const marked = { id: "dreamhackers", recordedAt: "2026-10-09T17:00:00.000Z", model: "m", result: { comps: [{ note: `unique tag ${SYNTHETIC_MARK}` }] } };
    const plain = { id: "plain", recordedAt: "2026-10-09T17:00:00.000Z", model: "m", result: { comps: [] } };
    expect(isSyntheticReplay(flagged)).toBe(true);
    expect(isSyntheticReplay(marked)).toBe(true);
    expect(isSyntheticReplay(plain)).toBe(false);
    const shared = new MemoryStore();
    Object.defineProperty(shared, "kind", { value: "upstash" });
    expect(await kv(shared).putReplay(flagged)).toBe(false);
    expect(await kv(shared).putReplay(marked)).toBe(false);
    expect(await kv(shared).putReplay(plain)).toBe(true);
    // Written before the guard (local store, then loaded into the shared one): not served.
    const local = new MemoryStore();
    expect(await kv(local).putReplay(flagged)).toBe(true);
    expect(await kv(local).putReplay(marked)).toBe(true);
    expect((await kv(local).replay("pennywell"))?.synthetic).toBe(true); // the flag survives trimming
    shared.load(local.dump());
    expect(await kv(shared).replay("pennywell")).toBeUndefined();
    expect(await kv(shared).replay("dreamhackers")).toBeUndefined();
    expect((await kv(shared).replay("plain"))?.id).toBe("plain");
    expect((await kv(local).replay("dreamhackers"))?.id).toBe("dreamhackers");
  });
});
