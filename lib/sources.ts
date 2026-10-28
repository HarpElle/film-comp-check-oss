import { MIN_SCORED_FOR_LABEL } from "./flag";
import { SKEW_THRESHOLD, skewDirection } from "./skew";
import type { Sources } from "./claims";
import type { AgentState } from "./tools";

/** Stable per-comp label used in source IDs: the user's title, with #2, #3 for repeats. */
export function compLabel(s: Readonly<AgentState>, key: string): string {
  const idx = s.comps.findIndex((c) => c.key === key);
  const t = s.comps[idx].input.title;
  const n = s.comps.slice(0, idx).filter((c) => c.input.title === t).length;
  return n ? `${t}#${n + 1}` : t;
}

/**
 * All tool results so far, by stable ID. Built from state, which only the tools write.
 * A source exists only once its tool has run.
 */
export function sourcesFromState(s: Readonly<AgentState>): Sources {
  const m: Sources = new Map();
  m.set("rule", { skewThreshold: SKEW_THRESHOLD, minScored: MIN_SCORED_FOR_LABEL });
  for (const c of s.comps) {
    const id = compLabel(s, c.key);
    const name = c.match?.matchedTitle ?? c.input.title;
    if (c.match) m.set(`resolve:${id}`, { title: c.input.title, badge: c.match.badge, matchedTitle: c.match.matchedTitle, matchedYear: c.match.matchedYear, directorInRecord: c.match.directorInRecord, directorFromDeck: c.match.directorFromDeck, thin: !!c.match.warning, warning: c.match.warning, reason: c.match.reason });
    if (c.fit) m.set(`deckfit:${id}`, { title: name, status: c.fit.status, affinity: c.fit.affinity, http: c.fit.http, error: c.fit.error });
    if (c.skew) {
      const d = s.skewLabel?.rows.find((r) => r.key === c.key);
      // dAge/dFemale and the age direction are computed here from the skew tool's output (lib/skew.ts SkewDirection);
      // ageDirection exists only when age is this comp's larger deviation, so a split line can tie its wording to it.
      const dir = d ? skewDirection(d.dFemale, d.dAge) : undefined;
      m.set(`skew:${id}`, { title: name, female: c.skew.female, age: c.skew.age, distance: d?.distance, standout: d?.standout, dAge: d?.dAge, dFemale: d?.dFemale, ageDirection: dir === "an older" ? "older" : dir === "a younger" ? "younger" : undefined, largerGap: d ? (Math.abs(d.dAge) >= Math.abs(d.dFemale) ? "age" : "female lean") : undefined, dAgeSign: d ? (d.dAge > 0 ? "older" : d.dAge < 0 ? "younger" : undefined) : undefined, error: c.skew.error });
    }
    if (c.views) m.set(`pageviews:${id}`, { title: name, views: c.views.views, article: c.views.article });
    if (c.tagLook) m.set(`tags:${id}`, { title: name, ...c.tagLook, note: c.tagNote });
    if (c.setAsideWhy) m.set(`state:${id}`, { setAsideWhy: c.setAsideWhy });
    const r = s.flag?.ranks[c.key];
    if (r) m.set(`rank:${id}`, { title: name, rank: r.rank, of: r.of, gapToNext: r.gapToNext });
  }
  if (s.resolveSummary) m.set("count:matched", { matched: s.resolveSummary.matched, total: s.resolveSummary.total, unmatched: s.resolveSummary.unmatched.length });
  if (s.flag && s.rankVersion >= 0) {
    const t = (k?: string) => (k ? s.comps.find((c) => c.key === k)!.match?.matchedTitle : undefined);
    m.set("rank_deck", { lowest: t(s.flag.lowest), lowestScore: s.flag.lowestScore, secondScore: s.flag.secondScore, gap: s.flag.gap, spread: s.flag.spread, label: s.flag.label, scored: Object.keys(s.flag.ranks).length });
  }
  if (s.skewVersion >= 0) {
    const o = s.skewOutlier;
    const t = o ? s.comps.find((c) => c.key === o.key)!.match?.matchedTitle : undefined;
    m.set("skew:deck", { available: (s.skewAttempted ?? 0) - (s.skewUnavailable?.length ?? 0), attempted: s.skewAttempted, missing: s.skewUnavailable?.length ?? 0, meanFemale: s.deckMean?.female, meanAge: s.deckMean?.age, k: s.skewLabel?.k, kind: s.skewLabel?.kind, outlier: t, direction: o?.direction, dFemale: o?.dFemale, dAge: o?.dAge });
  }
  if (s.pageviewsVersion >= 0) {
    m.set("pageviews:deck", { leastViewed: s.leastViewed ? s.comps.find((c) => c.key === s.leastViewed)!.match?.matchedTitle : undefined });
  }
  return m;
}
