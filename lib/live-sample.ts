import "server-only";
import { RESERVE, dailyCap, dayKey, clientIp, ipHash } from "./pacing";
import type { Kv } from "./kv";
import { deckKey } from "./tools";
import { fitDiffs, type LiveCompare } from "./compare";
import type { CheckResult, CompInput } from "./types";
import type { Recording } from "./trim";
import { sampleDeps } from "./samples";
import { memorySeedPath } from "./store";

/**
 * "Run live on Qloo" on a recorded sample deck (locked Oct 10/12).
 * Budget: one slice of SAMPLE_SLICE calls for the whole window through SLICE_END (Nov 16 2026, Chicago), on one
 * key (sample_live:slice) with no expiry, so neither a month change (Nov 1) nor Qloo's quota reset (about Nov 6)
 * adds calls. It is carved from the RESERVE that custom decks never touch: the quota may go down to SAMPLE_FLOOR.
 * Pacing: the first Chicago day the gate sees a valid quota reading above the floor is stored once
 * (sample_live:first_day). From then the allowance accrues linearly to SLICE_END:
 *   accrued = SAMPLE_SLICE * daysElapsed / totalDays   (both counted inclusive of the first day)
 *   available = accrued - used, in whole runs; a run unlocks only when that covers one whole run.
 * Through Nov 1 2026, at most one live sample run a day across all visitors (sample_live:day:<day>, 48 h).
 * One live sample run per visitor per day (sample_live:ip:<day>:<hash>, 48 h); the second run counts as the second.
 */
export const SAMPLE_SLICE = 500;
export const SAMPLE_FLOOR = RESERVE - SAMPLE_SLICE;
export const SLICE_END = "2026-11-16";
export const DAY_CAP_UNTIL = "2026-11-01";
/** Worst-case Qloo calls for one run of an n-comp deck: n searches, n leave-one-out fits, n audience estimates, plus n for a rescore or retries. */
export const callsPerRun = (n: number) => 4 * n;

const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);
/** Calls accrued by `today` from `firstDay` (YYYY-MM-DD, Chicago), linear to SLICE_END, never above SAMPLE_SLICE. */
export function sliceAccrued(firstDay: string, today: string): number {
  const total = dayNum(SLICE_END) - dayNum(firstDay) + 1;
  if (total <= 0) return 0;
  const elapsed = Math.min(total, Math.max(0, dayNum(today) - dayNum(firstDay) + 1));
  return Math.floor((SAMPLE_SLICE * elapsed) / total);
}

/** Test servers only: SAMPLE_CLOCK (ISO time) fixes the gate's clock; ignored whenever MEMORY_STORE_SEED is (Vercel, Upstash). */
export function sampleNow(): Date {
  const c = process.env.SAMPLE_CLOCK;
  return c && memorySeedPath() ? new Date(c) : new Date();
}

export interface SampleGateInput { enabled?: boolean; liveOn: boolean; quota?: { remaining: number; at: string }; sliceUsed: number; comps: number; now: Date; firstDay?: string; runsToday?: number }
export interface SampleGate { first: boolean; second: boolean; why?: "disabled" | "off" | "quota unknown" | "floor" | "ended" | "slice" | "today"; perRun: number; sliceLeft: number; runsAvailable: number; firstDay?: string }

const month = (d: Date) => dayKey(d).slice(0, 7);

/**
 * Gate for the button (first) and for the second, live-vs-live run.
 * first:  live mode on, a quota reading from this month, remaining - perRun >= SAMPLE_FLOOR, today <= SLICE_END,
 *         the accrued allowance covers one whole run, and (through Nov 1) no live sample run yet today.
 * second: first, and remaining - RESERVE >= today's daily pace (dailyCap) + 2 runs, and the allowance covers 2 runs.
 *         Through Nov 1 the 1-a-day cap leaves no room for a second run.
 * firstDay missing means the first available day is today (sampleGateFor stores it).
 */
export function sampleGate(i: SampleGateInput): SampleGate {
  const perRun = callsPerRun(i.comps), used = Math.max(0, i.sliceUsed), sliceLeft = Math.max(0, SAMPLE_SLICE - used);
  const today = dayKey(i.now), firstDay = i.firstDay ?? today;
  const avail = Math.min(sliceLeft, Math.max(0, sliceAccrued(firstDay, today) - used));
  const runsAvailable = Math.floor(avail / perRun);
  const no = (why: SampleGate["why"]): SampleGate => ({ first: false, second: false, why, perRun, sliceLeft, runsAvailable, firstDay: i.firstDay });
  if (i.enabled === false) return no("disabled");
  if (!i.liveOn) return no("off");
  const q = i.quota;
  if (!q || month(new Date(q.at)) !== month(i.now)) return no("quota unknown");
  if (q.remaining - perRun < SAMPLE_FLOOR) return no("floor");
  if (today > SLICE_END) return no("ended");
  if (runsAvailable < 1) return no("slice");
  const capped = today <= DAY_CAP_UNTIL;
  if (capped && (i.runsToday ?? 0) >= 1) return no("today");
  const second = !capped && q.remaining - RESERVE >= dailyCap(q.remaining, i.now) + 2 * perRun && runsAvailable >= 2;
  return { first: true, second, perRun, sliceLeft, runsAvailable, firstDay };
}

/**
 * SAMPLE_LIVE=1 turns "Run live on Qloo" on the samples on. Unset or any other value: off, so the gate stays closed
 * and the sample status line shows only "Run again", as a removed deck does.
 */
export const sampleLiveEnabled = () => process.env.SAMPLE_LIVE === "1";

export async function sampleGateFor(db: Kv, comps: number, now = sampleNow()): Promise<SampleGate> {
  const [quota, sliceUsed, firstDay, runsToday] = await Promise.all([db.quota(), db.sampleSliceUsed(), db.sampleFirstDay(), db.sampleLiveDayCount(dayKey(now))]);
  if (!sampleLiveEnabled()) return sampleGate({ liveOn: false, sliceUsed, comps, now, firstDay, runsToday, enabled: false });
  const liveOn = process.env.QLOO_LIVE !== "0";
  let fd = firstDay;
  // The first day quota is actually available: a valid reading this month, above the floor. Stored once.
  if (!fd && liveOn && quota && month(new Date(quota.at)) === month(now) && quota.remaining - callsPerRun(comps) >= SAMPLE_FLOOR && dayKey(now) <= SLICE_END) {
    fd = await db.putSampleFirstDay(dayKey(now));
  }
  return sampleGate({ liveOn, quota, sliceUsed, comps, now, firstDay: fd, runsToday });
}

/** Counts this visitor's live sample run today. The first run must be the day's first; the second, its second. */
export async function takeSampleVisitor(db: Kv, req: Request, second: boolean, now = sampleNow()): Promise<boolean> {
  const n = await db.bumpSampleLiveIp(dayKey(now), ipHash(clientIp(req)));
  return second ? n === 2 : n === 1;
}

/** Takes today's slot across all visitors: through Nov 1 only the day's first run gets one; after that, always. */
export async function takeSampleDay(db: Kv, now = sampleNow()): Promise<boolean> {
  const n = await db.bumpSampleLiveDay(dayKey(now));
  return dayKey(now) > DAY_CAP_UNTIL || n === 1;
}

/** After a live sample run: the slice takes the calls actually made; the quota reading is kept. Daily pace for custom decks is untouched. */
export async function recordSampleLive(db: Kv, calls: number, remaining: number | undefined, now = sampleNow()) {
  if (calls > 0) await db.bumpSampleSlice(calls);
  if (typeof remaining === "number") await db.putQuota(remaining, now.toISOString());
}

/** The recording's fit for this deck make-up, keyed by input title. */
export function recordedFits(fx: Recording, comps: CompInput[]): Record<string, number | undefined> {
  const rows = comps.map((c) => fx.comps.find((x) => x.input.title === c.title));
  const titles = rows.filter((r) => r?.match.badge === "Matched").map((r) => r!.match.matchedTitle!);
  const fit = fx.fit[deckKey(titles)] ?? {};
  return Object.fromEntries(comps.map((c, i) => [c.title, rows[i]?.match.matchedTitle ? fit[rows[i]!.match.matchedTitle!] : undefined]));
}

/** Live run vs the recording: fit differences by comp, dated from the recording's own recordedAt. */
export function compareWithRecording(r: CheckResult, fx: Recording, comps: CompInput[]): LiveCompare {
  return { kind: "recording", againstAt: fx.recordedAt, rows: fitDiffs(r, recordedFits(fx, comps)) };
}

/** Pageviews are context, not Qloo data: a live sample run shows the recorded counts and calls only Qloo live. */
export const recordedViews = (fx: Recording) => sampleDeps(fx).views;
