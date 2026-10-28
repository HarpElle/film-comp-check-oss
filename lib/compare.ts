import type { CheckResult } from "./types";
import { stampDate } from "./stamp";

export const NOT_COMPARABLE = "not comparable (audience check incomplete)";

/**
 * Run again: compares fit scores (6 decimals) comp by comp; the audience part only when both runs have a
 * complete audience check, otherwise it is reported as not comparable, never as a match.
 */
export function compareRuns(prev: CheckResult, next: CheckResult): { fit: "match" | "differ"; fitDiffs: string[]; audience: "match" | "differ" | typeof NOT_COMPARABLE; line: string } {
  const score = (r: CheckResult) => new Map(r.comps.map((c) => [c.match.input.title, typeof c.fit?.affinity === "number" ? c.fit.affinity.toFixed(6) : c.fit?.status ?? ""]));
  const a = score(prev), b = score(next);
  const fitDiffs = [...new Set([...a.keys(), ...b.keys()])].filter((t) => a.get(t) !== b.get(t));
  const incomplete = (r: CheckResult) => !r.audience || r.audience.unavailable.length > 0;
  const flags = (r: CheckResult) => JSON.stringify([r.verdictLines?.[1] ?? "", r.comps.map((c) => [c.match.input.title, !!c.skewFlag, !!c.skewSplit])]);
  const audience = incomplete(prev) || incomplete(next) ? NOT_COMPARABLE : flags(prev) === flags(next) ? "match" : "differ";
  const fit = fitDiffs.length ? "differ" : "match";
  const fitText = fit === "match" ? "fit scores match the previous run to 6 decimals" : `fit scores differ from the previous run for ${fitDiffs.join(", ")}`;
  const audText = audience === "match" ? "audience labels match" : audience === "differ" ? "audience labels differ" : `audience ${NOT_COMPARABLE}`;
  return { fit, fitDiffs, audience, line: `Run again: ${fitText}; ${audText}.` };
}

/** One comp's fit, this live run vs what it is compared with (the recording, or the first live run). */
export interface FitDiff { title: string; now?: number; before?: number; diff?: number; same6: boolean }
export interface LiveCompare { kind: "recording" | "live"; againstAt: string; rows: FitDiff[] }

/** Per-comp fit differences; `before` is keyed by the comp's input title. Equal means equal at 6 decimals. */
export function fitDiffs(next: CheckResult, before: Record<string, number | undefined>): FitDiff[] {
  return next.comps.map((c) => {
    const title = c.match.input.title;
    const now = typeof c.fit?.affinity === "number" ? c.fit.affinity : undefined, b = before[title];
    const both = typeof now === "number" && typeof b === "number";
    return { title, now, before: b, diff: both ? now! - b! : undefined, same6: both && now!.toFixed(6) === b!.toFixed(6) };
  });
}
export const fitsOf = (r: CheckResult): Record<string, number | undefined> => Object.fromEntries(r.comps.map((c) => [c.match.input.title, typeof c.fit?.affinity === "number" ? c.fit.affinity : undefined]));

/** The label. The date is always the one stored with the recording (formatted in CT), never written in code. */
export function liveCompareLabel(c: LiveCompare): string {
  return c.kind === "recording"
    ? `Live run vs recording from ${stampDate(c.againstAt)}. Qloo's data can change between them.`
    : "Second live run vs first live run (minutes apart).";
}
const sgn = (v: number, d: number) => (v > 0 ? "+" : v < 0 ? "\u2212" : "\u00b1") + Math.abs(v).toFixed(d);
/** Plain words: which comps matched to 6 decimals, which differ (by how much at `d` decimals: 3 on screen, 6 in export). */
export function liveCompareSummary(c: LiveCompare, d = 3): string {
  const same = c.rows.filter((r) => r.same6).map((r) => r.title);
  const diff = c.rows.filter((r) => !r.same6 && r.diff !== undefined);
  const none = c.rows.filter((r) => r.diff === undefined).map((r) => r.title);
  const parts: string[] = [];
  if (same.length === c.rows.length) parts.push(`All ${same.length} fit scores matched to 6 decimals.`);
  else {
    if (same.length) parts.push(`Matched to 6 decimals: ${same.join(", ")}.`);
    if (diff.length) parts.push(`Differs: ${diff.map((r) => `${r.title} (${sgn(r.diff!, d)})`).join(", ")}.`);
  }
  if (none.length) parts.push(`No fit score in one of the runs: ${none.join(", ")}.`);
  return parts.join(" ");
}
export const signedDiff = sgn;
