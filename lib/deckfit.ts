import type { DeckFitRow } from "./types";

export interface MatchedComp { key: string; entityId: string }
export interface LooInput { key: string; target: string; others: string[] }
export type FitScorer = (others: string[], target: string) => Promise<{ affinity?: number; http?: number; error?: string }>;

/** Leave-one-out inputs: each comp is scored against all the other active comps, in input order. */
export function buildLeaveOneOutInputs(active: MatchedComp[]): LooInput[] {
  return active.map((c) => ({ key: c.key, target: c.entityId, others: active.filter((o) => o.key !== c.key).map((o) => o.entityId) }));
}

/** One leave-one-out pass over the active comps. No dropping; callers decide what to do with Unscored rows. */
export async function scoreLeaveOneOut(active: MatchedComp[], scorer: FitScorer): Promise<DeckFitRow[]> {
  const out: DeckFitRow[] = [];
  for (const inp of buildLeaveOneOutInputs(active)) {
    const r = await scorer(inp.others, inp.target);
    out.push(typeof r.affinity === "number"
      ? { key: inp.key, entityId: inp.target, status: "Scored", affinity: r.affinity, http: r.http }
      : { key: inp.key, entityId: inp.target, status: "Unscored", http: r.http, error: r.error ?? "No score returned." });
  }
  return out;
}

/**
 * Score every active comp. Any comp that comes back without a score is marked Unscored,
 * dropped from the inputs, and the remaining comps are scored again until the set is stable.
 */
export async function computeDeckFit(matched: MatchedComp[], scorer: FitScorer): Promise<{ rows: Map<string, DeckFitRow>; rounds: number; dropped: string[] }> {
  const rows = new Map<string, DeckFitRow>();
  const dropped: string[] = [];
  let active = [...matched];
  let rounds = 0;
  while (true) {
    if (active.length < 2) {
      for (const c of active) rows.set(c.key, { key: c.key, entityId: c.entityId, status: "Not run", error: "Needs at least 2 scorable comps." });
      break;
    }
    rounds++;
    const failed: MatchedComp[] = [];
    for (const row of await scoreLeaveOneOut(active, scorer)) {
      rows.set(row.key, row);
      if (row.status === "Unscored") failed.push(active.find((x) => x.key === row.key)!);
    }
    if (!failed.length) break;
    dropped.push(...failed.map((f) => f.key));
    active = active.filter((c) => !failed.some((f) => f.key === c.key));
  }
  return { rows, rounds, dropped };
}

/** Lowest affinity is "consider cutting". Ties go to the earliest comp in input order. */
export function pickConsiderCutting(rows: DeckFitRow[]): { pick?: string; tied?: string[] } {
  const sc = rows.filter((r) => r.status === "Scored" && typeof r.affinity === "number");
  if (!sc.length) return {};
  const lo = Math.min(...sc.map((r) => r.affinity!));
  const tied = sc.filter((r) => r.affinity === lo).map((r) => r.key);
  return { pick: tied[0], tied: tied.length > 1 ? tied : undefined };
}
