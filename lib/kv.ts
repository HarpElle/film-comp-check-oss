import "server-only";
import { createHash } from "node:crypto";
import { getStore, type Store } from "./store";
import { entryBytes, MAX_ENTRY_BYTES, trimLanding, trimRecording, trimReplay, type LandingSnippet, type Recording, type Replay } from "./trim";
import type { CompInput } from "./types";

/**
 * Keys, TTLs and trimming for everything the app keeps in the store (lib/store.ts).
 * - sample:*  recorded sample decks, their replays (the full deck, and sample:replay:<id>:without:<titles> after a Remove) and the landing snippet: no expiry, ever.
 * - comp:*    a custom comp list's recorded Qloo results (comp titles plus trimmed Qloo fields): 30 days.
 * - ip:*      live checks per hashed IP per day: 48 hours.
 * - pace:*    live Qloo calls per day (daily pacing): 48 hours.
 * - quota:*   the last x-month-ratelimit-remaining seen: 40 days.
 * - sample_live:slice        Qloo calls used by "Run live on Qloo" on the samples, one total through Nov 16 2026: no expiry, never resets.
 * - sample_live:first_day    the first Chicago day the gate saw a valid quota reading above the floor, written once: no expiry.
 * - sample_live:day:<day>    live sample runs today across all visitors (the 1-a-day cap through Nov 1): 48 hours.
 * - sample_live:ip:<day>:<hash> live sample runs per hashed IP per day: 48 hours.
 */
export const TTL = { comp: 30 * 86_400, ip: 48 * 3_600, pace: 48 * 3_600, quota: 40 * 86_400, sampleLiveDay: 48 * 3_600, sampleLiveIp: 48 * 3_600 } as const;
export const K = {
  sampleIndex: "sample:index",
  sample: (id: string) => `sample:deck:${id}`,
  replay: (id: string) => `sample:replay:${id}`,
  /** A replay for a make-up of the sample after Remove: the removed titles, normalized and sorted. */
  replayWithout: (id: string, without: string[]) => `sample:replay:${id}:without:${without.map((t) => t.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()).sort().join("+")}`,
  landing: "sample:landing",
  comp: (comps: CompInput[]) => `comp:${createHash("sha256").update(compListKey(comps)).digest("hex").slice(0, 40)}`,
  ip: (day: string, ipHash: string) => `ip:${day}:${ipHash}`,
  pace: (day: string) => `pace:${day}`,
  quota: "quota:last",
  sampleSlice: "sample_live:slice",
  sampleFirstDay: "sample_live:first_day",
  sampleLiveDay: (day: string) => `sample_live:day:${day}`,
  sampleLiveIp: (day: string, ipHash: string) => `sample_live:ip:${day}:${ipHash}`,
};

/** The normalized exact comp list (order kept): what a custom comp list's cache entry is keyed by. */
export function compListKey(comps: CompInput[]): string {
  return comps.map((c) => `${c.title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}|${c.year ?? ""}|${(c.director ?? "").trim().replace(/\s+/g, " ").toLowerCase()}`).join("\n");
}

/** TTL policy by key prefix. Sample keys never expire; everything else always does. */
export function ttlFor(key: string): number | undefined {
  if (key.startsWith("sample:")) return undefined;
  if (key.startsWith("comp:")) return TTL.comp;
  if (key.startsWith("ip:")) return TTL.ip;
  if (key.startsWith("pace:")) return TTL.pace;
  if (key.startsWith("quota:")) return TTL.quota;
  if (key === K.sampleSlice || key === K.sampleFirstDay) return undefined;
  if (key.startsWith("sample_live:day:")) return TTL.sampleLiveDay;
  if (key.startsWith("sample_live:ip:")) return TTL.sampleLiveIp;
  throw new Error(`no TTL policy for key ${key}`);
}

/** Every write goes through here: TTL from the key, size checked. Returns false (and writes nothing) when too big or the store fails. */
async function put(store: Store, key: string, value: unknown): Promise<boolean> {
  if (entryBytes(value) > MAX_ENTRY_BYTES) return false;
  const ttlSec = ttlFor(key);
  try { await store.set(key, value, ttlSec ? { ttlSec } : undefined); return true; } catch { return false; }
}
async function read<T>(store: Store, key: string): Promise<T | undefined> {
  try { return await store.get<T>(key); } catch { return undefined; }
}

export interface SampleIndexEntry { id: string; label: string; recordedAt: string; comps: CompInput[] }

/** Synthetic test recordings (test/fixtures/synthetic.ts) carry this tag keyword; real Qloo data never does. */
export const SYNTHETIC_MARK = "synthetic keyword";
export function isSyntheticRecording(rec: unknown): boolean {
  const comps = (rec as { comps?: { tagLooks?: Record<string, { uniqueKeyword?: string }> }[] } | undefined)?.comps ?? [];
  return comps.some((c) => Object.values(c.tagLooks ?? {}).some((t) => t?.uniqueKeyword === SYNTHETIC_MARK));
}
/**
 * Synthetic test replays carry a top-level `synthetic: true`; as a second marker, any replay whose result text holds
 * SYNTHETIC_MARK (a replay built from a synthetic recording) counts too, so a replay that lost the flag is still caught.
 */
export function isSyntheticReplay(rep: unknown): boolean {
  if (!rep || typeof rep !== "object") return false;
  if ((rep as { synthetic?: unknown }).synthetic === true) return true;
  try { return JSON.stringify((rep as { result?: unknown }).result ?? null).includes(SYNTHETIC_MARK); } catch { return false; }
}
/** Production (Vercel production, or any shared Upstash store) must never hold or serve synthetic samples. */
function guarded(store: Store, env: Record<string, string | undefined> = process.env) { return store.kind === "upstash" || env.VERCEL_ENV === "production"; }

export function kv(store: Store = getStore()) {
  return {
    store,
    async putSample(rec: unknown): Promise<boolean> {
      const r = trimRecording(rec);
      if (!r.id) return false;
      if (guarded(store) && isSyntheticRecording(r)) return false; // never seed the shared store with test data
      const ok = await put(store, K.sample(r.id), r);
      if (!ok) return false;
      const idx = ((await read<SampleIndexEntry[]>(store, K.sampleIndex)) ?? []).filter((e) => e.id !== r.id);
      idx.push({ id: r.id, label: r.label, recordedAt: r.recordedAt, comps: r.comps.map((c) => c.input) });
      return put(store, K.sampleIndex, idx);
    },
    async sampleIndex(): Promise<SampleIndexEntry[]> {
      const idx = (await read<SampleIndexEntry[]>(store, K.sampleIndex)) ?? [];
      if (!guarded(store) || !idx.length) return idx;
      const ok = new Set((await this.samples()).map((r) => r.id));
      return idx.filter((e) => ok.has(e.id));
    },
    async samples(): Promise<Recording[]> {
      const idx = (await read<SampleIndexEntry[]>(store, K.sampleIndex)) ?? [];
      if (!idx.length) return [];
      try { return (await store.mget<Recording>(idx.map((e) => K.sample(e.id)))).filter((r): r is Recording => !!r && !(guarded(store) && isSyntheticRecording(r))); } catch { return []; }
    },
    putReplay: (r: unknown) => {
      const t = trimReplay(r);
      if (!t.id || (guarded(store) && isSyntheticReplay(t))) return Promise.resolve(false); // never seed the shared store with a test replay
      return put(store, t.without?.length ? K.replayWithout(t.id, t.without) : K.replay(t.id), t);
    },
    /** The full deck's replay, or with `without`, the replay recorded for that make-up after a Remove. */
    async replay(id: string, without?: string[]): Promise<Replay | undefined> {
      const r = await read<Replay>(store, without?.length ? K.replayWithout(id, without) : K.replay(id));
      return r && guarded(store) && isSyntheticReplay(r) ? undefined : r;
    },
    putLanding: (l: unknown) => put(store, K.landing, trimLanding(l)),
    async landing(): Promise<LandingSnippet | undefined> {
      const l = await read<LandingSnippet>(store, K.landing);
      if (!l || !guarded(store)) return l;
      const idx = (await read<SampleIndexEntry[]>(store, K.sampleIndex)) ?? [];
      for (const e of idx) if (isSyntheticRecording(await read(store, K.sample(e.id)))) return undefined; // seeded by a test run: show nothing rather than fake numbers
      return l;
    },
    /** Custom comp list: comp titles plus trimmed Qloo fields, never year/director text or a deck name. 30 days. */
    putComp: (comps: CompInput[], rec: unknown) => put(store, K.comp(comps), trimRecording({ ...(rec as object), id: "custom" }, { titleOnly: true })),
    comp: (comps: CompInput[]) => read<Recording>(store, K.comp(comps)),
    bumpIp: (day: string, ipHash: string) => store.incr(K.ip(day, ipHash), { ttlSec: TTL.ip }),
    ipCount: async (day: string, ipHash: string) => (await read<number>(store, K.ip(day, ipHash))) ?? 0,
    bumpPace: (day: string, by: number) => store.incr(K.pace(day), { ttlSec: TTL.pace, by }),
    paceCount: async (day: string) => (await read<number>(store, K.pace(day))) ?? 0,
    putQuota: (remaining: number, at: string) => put(store, K.quota, { remaining, at }),
    quota: () => read<{ remaining: number; at: string }>(store, K.quota),
    /** The sample slice: Qloo calls used by live sample runs over the whole window (actual calls, counted after each run). One key, no expiry. */
    bumpSampleSlice: (by: number) => store.incr(K.sampleSlice, { by }), // atomic, no expiry
    sampleSliceUsed: async () => (await read<number>(store, K.sampleSlice)) ?? 0,
    sampleFirstDay: () => read<string>(store, K.sampleFirstDay),
    /** Written once: a later call keeps the first day already stored. */
    async putSampleFirstDay(day: string): Promise<string> { const had = await read<string>(store, K.sampleFirstDay); if (had) return had; await put(store, K.sampleFirstDay, day); return day; },
    bumpSampleLiveDay: (day: string) => store.incr(K.sampleLiveDay(day), { ttlSec: TTL.sampleLiveDay }),
    sampleLiveDayCount: async (day: string) => (await read<number>(store, K.sampleLiveDay(day))) ?? 0,
    bumpSampleLiveIp: (day: string, ipHash: string) => store.incr(K.sampleLiveIp(day, ipHash), { ttlSec: TTL.sampleLiveIp }),
    sampleLiveIpCount: async (day: string, ipHash: string) => (await read<number>(store, K.sampleLiveIp(day, ipHash))) ?? 0,
  };
}
export type Kv = ReturnType<typeof kv>;
