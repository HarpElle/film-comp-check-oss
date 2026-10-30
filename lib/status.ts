import { kv } from "./kv";
import { IP_DAILY_LIVE_CHECKS, liveMode, maybeProbeQuota } from "./pacing";
import { sampleGateFor, sampleLiveEnabled } from "./live-sample";
import { QlooClient } from "./qloo";
import type { CompInput } from "./types";

/** What the page needs before anyone types (GET /api/status, and the server render of the landing). */
export interface PageStatus {
  qlooLive: boolean;
  judge?: boolean;
  paused?: string;
  samples: { id: string; label: string; comps: CompInput[] }[];
  landing?: { deck: string; comps: number; verdictLines: string[]; recordedAt?: string };
  sampleLive?: Record<string, { first: boolean; second: boolean }>;
  /** SAMPLE_LIVE=1: the samples may offer "Run live on Qloo" (or the quiet line when the gate is closed). Off: only "Run again". */
  sampleLiveOn?: boolean;
  /** Live checks each visitor gets per day (IP_DAILY_LIVE_CHECKS), for the note under Check comps (UX audit WP-12). */
  liveChecksPerDay?: number;
}

/** One cheap search, cache bypassed, only to read x-month-ratelimit-remaining (at most hourly, only while paused for quota). */
async function probe(): Promise<number | undefined> {
  let rem: number | undefined;
  const q = new QlooClient({ bypassCache: true, maxRetries: 0, timeoutMs: 4000, onQuota: (r) => { rem = r; } });
  try { await q.searchMovies("Casablanca"); } catch { /* the header is what we wanted */ }
  return rem;
}

/** Live or paused, the recorded samples, the landing snippet. No Qloo call (except the hourly probe while paused). */
export async function pageStatus(): Promise<PageStatus> {
  const db = kv();
  let mode = await liveMode(db);
  if (mode.mode !== "live" && mode.reason === "quota" && (await maybeProbeQuota(db, probe))) mode = await liveMode(db);
  const [samples, landing] = await Promise.all([db.sampleIndex(), db.landing()]);
  // "Run live on Qloo" gate per sample deck (no per-visitor state here; the run itself checks the visitor).
  const sampleLive = Object.fromEntries(await Promise.all(samples.map(async (s) => { const g = await sampleGateFor(db, s.comps.length); return [s.id, { first: g.first, second: g.second }] as const; })));
  return {
    qlooLive: mode.mode === "live",
    // Judge mode: no Qloo key, or live checks switched off. Samples still run from the recording.
    judge: process.env.QLOO_LIVE === "0" || !process.env.QLOO_API_KEY,
    paused: mode.mode === "live" ? undefined : mode.message,
    samples,
    sampleLive,
    sampleLiveOn: sampleLiveEnabled(),
    liveChecksPerDay: IP_DAILY_LIVE_CHECKS(),
    landing: landing?.verdictLines?.length ? landing : undefined,
  };
}
