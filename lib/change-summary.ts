import type { CheckResult, CompResult } from "./types";

/**
 * Change summary after a Remove (design spec, Remove): one sentence per remaining comp whose cut label or skew flag
 * changed between the two computed results, or "No flags changed." Labels are the computed ones only.
 */
export const cutOf = (c: CompResult): string | undefined => (c.considerCutting ? c.cutLabel : undefined);
export const skewOf = (c: CompResult): string | undefined => (c.skewFlag ? "Audience outlier" : c.skewSplit ? "Audience split" : undefined);
const titleOf = (c: CompResult) => c.match.input.title;
const same = (a: CompResult, b: CompResult) => titleOf(a) === titleOf(b) && (a.match.input.year ?? null) === (b.match.input.year ?? null);

export function flagChanges(before: CheckResult, after: CheckResult): string[] {
  const out: string[] = [];
  for (const c of after.comps) {
    const was = before.comps.find((b) => same(b, c));
    if (!was) continue;
    for (const pick of [cutOf, skewOf]) {
      const a = pick(was), b = pick(c);
      if (a !== b) out.push(`${titleOf(c)} changed from ${a ?? "no flag"} to ${b ?? "no flag"}.`);
    }
  }
  return out;
}

export function removalSummary(removedTitle: string, before: CheckResult, after: CheckResult): string {
  const ch = flagChanges(before, after);
  return [`Rechecked without ${removedTitle}.`, ...(ch.length ? ch : ["No flags changed."])].join(" ");
}

/** Puts a removed comp back at its original index (Undo). */
export function restoreAt<T>(list: T[], item: T, index: number): T[] {
  const out = [...list];
  out.splice(Math.max(0, Math.min(index, out.length)), 0, item);
  return out;
}
