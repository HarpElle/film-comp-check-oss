/**
 * Display only: the "below next" gap as the difference of the two fit scores as shown (3 decimals), so every gap on
 * screen and in the exports equals the difference of the scores printed beside it. The rank, the cut rule and the
 * result's numbers keep the exact gap; only the text a person reads changes.
 */
import { CLOSE_CALL } from "./flag";
import type { AgentStep, CheckResult, CompResult } from "./types";

const thousandths = (x: number) => Math.round(Number(x.toFixed(3)) * 1000);

export function shownGap(affinity: number, nextAffinity: number): string {
  return ((thousandths(nextAffinity) - thousandths(affinity)) / 1000).toFixed(3);
}

/** A scored comp's gap to the next higher comp, as shown, or undefined for the top comp (or an unscored one). */
export function compGap(c: CompResult, comps: CompResult[]): string | undefined {
  const a = c.fit?.affinity;
  if (!c.rank || c.rank.gapToNext === undefined || typeof a !== "number") return undefined;
  const next = comps.find((x) => x.rank?.rank === c.rank!.rank - 1)?.fit?.affinity;
  return shownGap(a, typeof next === "number" ? next : a + c.rank.gapToNext);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The fit verdict line, built from the computed label, lowest comp, its score and its shown gap. */
export function fitLine(c: CompResult, gap: string): string {
  const lead = c.cutLabel === CLOSE_CALL ? "Fit ranking: no comp clearly stands apart. " : "";
  return `${lead}${c.cutLabel}: ${c.match.matchedTitle ?? c.match.input.title} (${c.fit!.affinity!.toFixed(3)}, ${gap} below the next comp).`;
}
const isFitLine = (l: string, label: string) => l.startsWith("Fit ranking:") || l.startsWith(`${label}:`);

/**
 * The result as people read it: the verdict's fit line rendered from the computed shown gap (not the stored string),
 * the Why lines (and their export form) and the step log quoting each comp's shown gap instead of the exact one.
 * Idempotent; numbers, ranks, labels and cutGap are untouched.
 */
export function withShownGaps(r: CheckResult): CheckResult {
  const gaps = new Map<string, { exact: string; shown: string }>();
  for (const c of r.comps) {
    const shown = compGap(c, r.comps);
    if (shown !== undefined) gaps.set(c.key, { exact: c.rank!.gapToNext!.toFixed(3), shown });
  }
  const cut = r.comps.find((c) => c.considerCutting && c.cutLabel && typeof c.fit?.affinity === "number" && gaps.has(c.key));
  const cutGap = cut && gaps.get(cut.key)!;
  const deckGap = cutGap && typeof r.cutGap === "number" && r.cutGap.toFixed(3) === cutGap.exact ? cutGap : undefined;
  const fix = (s: string, g?: { exact: string; shown: string }) => {
    if (!g || g.exact === g.shown) return s;
    // The exact gap where it is quoted as a gap: "X below the next comp", "Gap X", "gap X to the next comp", "gap to next X".
    return s.replace(new RegExp(`${esc(g.exact)}(?= below the next comp)|(\\bgap\\b(?: to next)?:?\\s+)${esc(g.exact)}(?!\\d)`, "gi"), (_m, pre?: string) => `${pre ?? ""}${g.shown}`);
  };
  const comps = r.comps.map((c) => {
    const g = gaps.get(c.key), extra = c === cut ? deckGap : undefined;
    const f = (s: string) => fix(fix(s, g), extra);
    return g ? { ...c, reasons: c.reasons.map(f), reasonsExport: c.reasonsExport?.map(f) } : c;
  });
  const stepFix = (st: AgentStep): AgentStep => {
    if (!deckGap) return st;
    const basis = st.choice?.basis;
    return {
      ...st, reason: fix(st.reason, deckGap), outcome: st.outcome && fix(st.outcome, deckGap),
      choice: st.choice && { ...st.choice, basis: basis && (basis.field === "gap" && basis.value === deckGap.exact ? { ...basis, value: deckGap.shown } : basis) },
    };
  };
  let verdictLines = r.verdictLines, verdict = r.verdict;
  if (cut && cutGap && verdictLines) {
    const line = fitLine(cut, cutGap.shown);
    const i = verdictLines.findIndex((l) => isFitLine(l, cut.cutLabel!));
    if (i >= 0) {
      const old = verdictLines[i];
      verdictLines = verdictLines.map((l, j) => (j === i ? line : l));
      if (verdict) verdict = verdict.replace(old, line);
    }
  }
  return { ...r, comps, verdictLines, verdict, steps: r.steps?.map(stepFix) };
}
