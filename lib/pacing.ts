import "server-only";
import { createHash } from "node:crypto";
import type { Kv } from "./kv";

/**
 * Daily pacing of live Qloo calls and the per-visitor limit.
 * Budget for today = (last x-month-ratelimit-remaining - RESERVE) / days left in the month, counted from
 * the start of today. When today's live calls reach it, custom decks switch to recorded (paused) for the
 * rest of the day; samples always run from their recording. A reading from an earlier month is stale
 * (the quota resets monthly), so checks go live again and the first live response sets the new number.
 */
export const RESERVE = 1000;
export const IP_DAILY_LIVE_CHECKS = () => Number(process.env.IP_DAILY_LIVE_CHECKS ?? 5);
export { VISITOR_LIMIT } from "./messages";
export const PAUSED_OFF = "Live Qloo checks are paused. The sample decks run from a recorded Qloo run.";
export const PAUSED_QUOTA = "Live Qloo checks are paused: this month's Qloo request quota is used up. The sample decks run from a recorded Qloo run.";
export const PAUSED_TODAY = "Live Qloo checks are paused for today: today's share of this month's Qloo requests is used. The sample decks run from a recorded Qloo run.";

const TZ = "America/Chicago";
const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
/** YYYY-MM-DD in Chicago time. */
export function dayKey(now: Date): string { const p = parts(now); return `${p.year}-${p.month}-${p.day}`; }
const monthKey = (now: Date) => dayKey(now).slice(0, 7);
/** Days left in this month, today included (Chicago time). */
export function daysLeftInMonth(now: Date): number {
  const p = parts(now);
  const last = new Date(Date.UTC(Number(p.year), Number(p.month), 0)).getUTCDate();
  return last - Number(p.day) + 1;
}
/** Live Qloo calls allowed today, given the remaining quota at the start of today. */
export function dailyCap(remainingAtStartOfDay: number, now: Date): number {
  return Math.max(0, Math.floor((remainingAtStartOfDay - RESERVE) / daysLeftInMonth(now)));
}

export type LiveMode =
  | { mode: "live"; cap?: number; usedToday: number }
  | { mode: "recorded"; reason: "off" | "quota" | "paced"; message: string; cap?: number; usedToday: number };

export async function liveMode(db: Kv, now = new Date()): Promise<LiveMode> {
  const usedToday = await db.paceCount(dayKey(now));
  if (process.env.QLOO_LIVE === "0") return { mode: "recorded", reason: "off", message: PAUSED_OFF, usedToday };
  const q = await db.quota();
  if (!q || monthKey(new Date(q.at)) !== monthKey(now)) return { mode: "live", usedToday }; // no reading this month: go live, the response tells us
  if (q.remaining <= RESERVE) return { mode: "recorded", reason: "quota", message: PAUSED_QUOTA, usedToday };
  const start = dayKey(new Date(q.at)) === dayKey(now) ? q.remaining + usedToday : q.remaining;
  const cap = dailyCap(start, now);
  if (usedToday >= cap) return { mode: "recorded", reason: "paced", message: PAUSED_TODAY, cap, usedToday };
  return { mode: "live", cap, usedToday };
}

/** After a live run: count its Qloo calls for today and keep the latest remaining-quota reading. */
export async function recordLive(db: Kv, calls: number, remaining: number | undefined, now = new Date()) {
  if (calls > 0) await db.bumpPace(dayKey(now), calls);
  if (typeof remaining === "number") await db.putQuota(remaining, now.toISOString());
}

/** Visitors are counted by a salted hash of the IP (the IP itself is never stored). */
export function ipHash(ip: string): string {
  return createHash("sha256").update(`${process.env.IP_HASH_SALT ?? "film-comp-check"}|${ip}`).digest("hex").slice(0, 32);
}
export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
/** Counts one live check for this visitor today; false when over the daily limit. */
export async function takeVisitorCheck(db: Kv, req: Request, now = new Date()): Promise<boolean> {
  const n = await db.bumpIp(dayKey(now), ipHash(clientIp(req)));
  return n <= IP_DAILY_LIVE_CHECKS();
}

/** Burst guard: Vercel Firewall rate-limit rule, only when FIREWALL_RATE_LIMIT_ID is set (no-op otherwise). */
export async function firewallLimited(req: Request): Promise<boolean> {
  const id = process.env.FIREWALL_RATE_LIMIT_ID;
  if (!id) return false;
  try {
    const { checkRateLimit } = await import("@vercel/firewall");
    const r = await checkRateLimit(id, { request: req });
    return r.rateLimited;
  } catch { return false; }
}

/** While paused for quota: at most one probe an hour (a single Qloo search, cache bypassed) to see whether quota came back. */
export async function maybeProbeQuota(db: Kv, probe: () => Promise<number | undefined>, now = new Date()): Promise<boolean> {
  if (process.env.QUOTA_PROBE === "0" || process.env.QLOO_LIVE === "0") return false;
  const q = await db.quota();
  if (!q || q.remaining > RESERVE || now.getTime() - new Date(q.at).getTime() < 3_600_000) return false;
  await db.putQuota(q.remaining, now.toISOString()); // claim this hour's probe before calling
  let rem: number | undefined;
  try { rem = await probe(); } catch { rem = undefined; }
  if (typeof rem === "number") await db.putQuota(rem, now.toISOString());
  return true;
}
