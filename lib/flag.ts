/**
 * Locked label rule (buildweek/flag_rule.md, sha256 e27f9a6b...). Plain code; no tuning.
 * lowest = lowest deck-fit among scored comps (needs at least 3 scored).
 * gap = second-lowest minus lowest. spread = max minus min of the OTHER scored comps.
 * gap > spread -> "Consider cutting"; else "Lowest fit, close call".
 * Every scored comp gets a rank (1 = best fit) and its gap to the next higher comp.
 */
export type CutLabel = "Consider cutting" | "Lowest fit, close call";
export const CONSIDER_CUTTING: CutLabel = "Consider cutting";
export const CLOSE_CALL: CutLabel = "Lowest fit, close call";
export const MIN_SCORED_FOR_LABEL = 3;

export interface RankInfo { rank: number; of: number; gapToNext?: number }
export interface FlagOutcome {
  ranks: Record<string, RankInfo>;
  lowest?: string;
  lowestScore?: number;
  secondScore?: number;
  gap?: number;
  spread?: number;
  label?: CutLabel;
  tiedLowest?: string[];
}

export function labelLowest(rows: { key: string; affinity: number }[]): FlagOutcome {
  // Best first; ties keep input order.
  const sorted = rows.map((r, i) => ({ ...r, i })).sort((a, b) => b.affinity - a.affinity || a.i - b.i);
  const of = sorted.length;
  const ranks: Record<string, RankInfo> = {};
  sorted.forEach((r, idx) => {
    ranks[r.key] = { rank: idx + 1, of, gapToNext: idx === 0 ? undefined : sorted[idx - 1].affinity - r.affinity };
  });
  if (of < MIN_SCORED_FOR_LABEL) return { ranks };
  const lo = Math.min(...rows.map((r) => r.affinity));
  const tied = rows.filter((r) => r.affinity === lo).map((r) => r.key);
  const lowest = tied[0]; // earliest in input order
  const others = rows.filter((r) => r.key !== lowest).map((r) => r.affinity);
  const second = Math.min(...others);
  const gap = second - lo;
  const spread = Math.max(...others) - Math.min(...others);
  return {
    ranks, lowest, lowestScore: lo, secondScore: second, gap, spread,
    label: gap > spread ? CONSIDER_CUTTING : CLOSE_CALL,
    tiedLowest: tied.length > 1 ? tied : undefined,
  };
}
