import { pickMatch } from "./match";
import { MIN_MATCHED_FOR_FIT } from "./limits";
export { MIN_MATCHED_FOR_FIT };
import { scoreLeaveOneOut, type FitScorer } from "./deckfit";
import { skewLabel, skewScores, type SkewDirection, type SkewLabel } from "./skew";
import { QlooError, type DemoQuery, type QlooEntity } from "./qloo";
import type { CompInput, DeckFitRow, MatchResult, SkewRow } from "./types";
import { labelLowest, MIN_SCORED_FOR_LABEL, type FlagOutcome } from "./flag";

/**
 * Data access the tools need. The live app wires these to Qloo and Wikipedia; tests pass mocks.
 * All scoring happens in plain code here. The model (or stub) only chooses which tool to call next.
 */
export interface ToolDeps {
  search(title: string): Promise<QlooEntity[]>;
  /** Recorded samples: the match as recorded, instead of search + pickMatch. */
  resolve?(input: CompInput): Promise<MatchResult>;
  /** Recorded samples: the audience scores as recorded, instead of demographics + skewScores. */
  audience?(entityId: string): Promise<{ female?: number; age?: number }>;
  fit: FitScorer;
  /** One audience estimate. Honor the signal: it fires when the call's own timeout or the skew budget runs out. */
  demographics(entityId: string, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<DemoQuery | undefined>;
  /** Skew limits (defaults: SKEW_BUDGET_MS total, DEMO_TIMEOUT_MS per call, DEMO_CONCURRENCY at once). */
  skewLimits?: { budgetMs?: number; callTimeoutMs?: number; concurrency?: number };
  views(title: string, year: number | undefined): Promise<{ article?: string; views?: number; error?: string }>;
}

export interface AgentComp {
  key: string;
  input: CompInput;
  state: "pending" | "active" | "dropped" | "set_aside";
  match?: MatchResult;
  fit?: DeckFitRow;
  skew?: SkewRow;
  views?: { article?: string; views?: number; error?: string };
  setAsideWhy?: string;
  tagLook?: TagLook;
  searchError?: string; // set when Qloo couldn't be reached for this comp's search (not a no-match)
  tagNote?: string;
}

export interface TagLook { totalTags: number; sharedWithDeck: number; uniqueGenre?: string; uniqueKeyword?: string; uniqueCount: number }

export interface AgentState {
  comps: AgentComp[];
  deckVersion: number; // bumps on every drop or set-aside
  scoredVersion: number; // deckVersion at the last score_deck/rerun, -1 if never
  skewVersion: number;
  pageviewsVersion: number;
  considerCutting?: string;
  tied?: string[];
  cutFlagged: boolean;
  skewFlagged: boolean;
  skewOutlier?: { key: string; dFemale: number; dAge: number; direction: SkewDirection }; // only when k = 1
  skewSplit?: string[]; // keys in deck order, only when k >= 2
  skewLabel?: SkewLabel;
  skewUnavailable?: string[]; // scored comps with no audience estimate this run (deck order); left out of the mean and the label
  skewAttempted?: number; // scored comps the estimate was asked for
  deckMean?: { female: number; age: number };
  leastViewed?: string;
  rankVersion: number;
  flag?: FlagOutcome;
  resolveSummary?: { matched: number; total: number; unmatched: string[]; allNameDirector: boolean };
  finished: boolean;
}

export function initialState(inputs: CompInput[]): AgentState {
  return {
    comps: inputs.map((input, i) => ({ key: `c${i}`, input, state: "pending" })),
    deckVersion: 0, scoredVersion: -1, skewVersion: -1, pageviewsVersion: -1, rankVersion: -1,
    cutFlagged: false, skewFlagged: false, finished: false,
  };
}

export const active = (s: AgentState) => s.comps.filter((c) => c.state === "active");

export async function resolveComp(s: AgentState, key: string, deps: ToolDeps): Promise<unknown> {
  const c = s.comps.find((x) => x.key === key)!;
  try {
    c.match = deps.resolve ? await deps.resolve(c.input) : pickMatch(c.input, await deps.search(c.input.title));
  } catch (e) {
    // A failed search is not a no-match: Qloo didn't answer, so the run ends with an error (resolveComps).
    c.match = { input: c.input, badge: "Unmatched", reason: `Search failed (${e instanceof Error ? e.message : "error"}).` };
    c.searchError = qlooUnavailableMessage(e);
  }
  c.state = "active";
  return { badge: c.match.badge, matchedTitle: c.match.matchedTitle, matchedYear: c.match.matchedYear, warning: c.match.warning, reason: c.match.reason };
}

/** Resolve every pending comp, one search each, in input order. */
export async function resolveComps(s: AgentState, deps: ToolDeps): Promise<unknown> {
  const per: unknown[] = [];
  const pending = s.comps.filter((x) => x.state === "pending");
  for (const c of pending) per.push(await resolveComp(s, c.key, deps));
  // Any failed search ends the run: a verdict over the comps that did resolve would read as complete.
  const failed = pending.find((c) => c.searchError);
  if (failed) throw new QlooUnavailable(failed.searchError!);
  const matched = s.comps.filter((c) => c.match?.badge === "Matched");
  s.resolveSummary = {
    matched: matched.length,
    total: s.comps.length,
    unmatched: s.comps.filter((c) => c.match?.badge === "Unmatched").map((c) => c.input.title),
    allNameDirector: matched.length > 0 && matched.every((c) => !!c.input.director?.trim() && !!c.match!.directorInRecord), // verified against the deck's director
  };
  return { ...s.resolveSummary, comps: per };
}

export function resolveSummaryLine(r: NonNullable<AgentState["resolveSummary"]>): string {
  let line = `Matched ${r.matched} of ${r.total} comps to Qloo movie records`;
  line += r.allNameDirector ? " (each record names its director)." : ".";
  if (r.unmatched.length) line += ` ${r.unmatched.length} unmatched: ${r.unmatched.join(", ")}.`;
  return line;
}

/** Apply the locked label rule (lib/flag.ts) to the current scores. */
export function rankDeck(s: AgentState): unknown {
  const sc = active(s).filter((c) => c.fit?.status === "Scored" && typeof c.fit.affinity === "number");
  const f = labelLowest(sc.map((c) => ({ key: c.key, affinity: c.fit!.affinity! })));
  s.flag = f; s.rankVersion = s.deckVersion;
  const t = (k?: string) => (k ? s.comps.find((c) => c.key === k)!.match?.matchedTitle : undefined);
  return {
    scored: sc.length, minScored: MIN_SCORED_FOR_LABEL,
    ranks: sc.map((c) => ({ title: t(c.key), affinity: c.fit!.affinity, ...f.ranks[c.key] })),
    lowest: t(f.lowest), lowestScore: f.lowestScore, secondScore: f.secondScore, gap: f.gap, spread: f.spread, label: f.label,
  };
}

export function dropComp(s: AgentState, key: string): unknown {
  const c = s.comps.find((x) => x.key === key)!;
  c.state = "dropped"; s.deckVersion++;
  return { dropped: c.input.title };
}

export function setAsideComp(s: AgentState, key: string, why: string): unknown {
  const c = s.comps.find((x) => x.key === key)!;
  c.state = "set_aside"; c.setAsideWhy = why; s.deckVersion++;
  return { setAside: c.input.title };
}

/** score_deck and rerun share this: one leave-one-out pass over the comps still active. */
export async function scoreDeck(s: AgentState, deps: ToolDeps): Promise<unknown> {
  const act = active(s).filter((c) => c.match?.badge === "Matched");
  for (const c of s.comps) if (c.state === "active") c.fit = undefined;
  if (act.length < MIN_MATCHED_FOR_FIT) {
    for (const c of act) c.fit = { key: c.key, entityId: c.match!.entityId!, status: "Not run", error: `Needs at least ${MIN_MATCHED_FOR_FIT} matched comps.` };
  } else {
    const rows = await scoreLeaveOneOut(act.map((c) => ({ key: c.key, entityId: c.match!.entityId! })), deps.fit);
    for (const r of rows) s.comps.find((c) => c.key === r.key)!.fit = r;
  }
  s.scoredVersion = s.deckVersion;
  return act.map((c) => ({ title: c.match!.matchedTitle, status: c.fit!.status, affinity: c.fit!.affinity, http: c.fit!.http }));
}

export const SKEW_BUDGET_MS = 15_000;
export const DEMO_TIMEOUT_MS = 5_000;
export const DEMO_CONCURRENCY = 3;
export const UNAVAILABLE = "audience estimate unavailable";

/**
 * Audience estimates for every scored comp, in parallel (small pool), each call with its own timeout, all
 * inside one budget. A comp whose call fails, times out or misses the budget gets "audience estimate
 * unavailable" (skew.error holds why) and is left out of the deck mean and the skew label; nothing is invented or carried over.
 * The label rule itself (threshold SKEW_THRESHOLD) runs unchanged over the comps that have one.
 */
export async function skewTool(s: AgentState, deps: ToolDeps): Promise<unknown> {
  const sc = active(s).filter((c) => c.fit?.status === "Scored");
  const lim = deps.skewLimits ?? {};
  const budgetMs = lim.budgetMs ?? SKEW_BUDGET_MS, callMs = lim.callTimeoutMs ?? DEMO_TIMEOUT_MS, conc = lim.concurrency ?? DEMO_CONCURRENCY;
  for (const c of sc) c.skew = undefined;
  const budget = new AbortController();
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetOut = new Promise<"budget">((res) => { budgetTimer = setTimeout(() => { budget.abort(); res("budget"); }, budgetMs); });
  const one = async (c: AgentComp) => {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    budget.signal.addEventListener("abort", stop, { once: true });
    let t: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((res) => { t = setTimeout(() => { ctrl.abort(); res("timeout"); }, callMs); });
    try {
      // Race too, so a call that ignores its signal still cannot hold the run.
      const call = deps.audience ? deps.audience(c.fit!.entityId).then((v) => ({ recorded: v })) : deps.demographics(c.fit!.entityId, { signal: ctrl.signal, timeoutMs: callMs });
      const r = await Promise.race([call, timedOut, budgetOut]);
      if (r === "timeout") c.skew = { key: c.key, error: `no answer within ${callMs / 1000} s` };
      else if (r === "budget") c.skew = { key: c.key, error: "audience time budget used up" };
      else {
        const v = r && typeof r === "object" && "recorded" in r ? (r as { recorded: { female?: number; age?: number } }).recorded : skewScores(r as DemoQuery | undefined);
        c.skew = { key: c.key, ...v, error: v.female === undefined || v.age === undefined ? "missing age or gender values" : undefined };
      }
    } catch (e) {
      c.skew = { key: c.key, error: e instanceof Error ? e.message : "error" };
    } finally {
      clearTimeout(t); budget.signal.removeEventListener("abort", stop);
    }
  };
  const queue = [...sc];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (budget.signal.aborted) { c.skew = { key: c.key, error: "audience time budget used up" }; continue; }
      await one(c);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, sc.length) }, worker));
  clearTimeout(budgetTimer);
  for (const c of sc) if (!c.skew) c.skew = { key: c.key, error: "audience time budget used up" };
  const ok = sc.filter((c) => c.skew && !c.skew.error);
  const f = skewLabel(ok.map((c) => ({ key: c.key, female: c.skew!.female!, age: c.skew!.age! })));
  s.skewLabel = f; s.deckMean = f.mean; s.skewOutlier = f.outlier; s.skewSplit = f.split.length ? f.split : undefined; s.skewVersion = s.deckVersion;
  s.skewUnavailable = sc.filter((c) => c.skew?.error).map((c) => c.key);
  s.skewAttempted = sc.length;
  return { k: f.k, kind: f.kind, available: ok.length, of: sc.length };
}

/** Pageviews for the given comps (default: all scored). Least viewed is over every comp with a count so far. */
export async function pageviewsTool(s: AgentState, deps: ToolDeps, keys?: string[]): Promise<unknown> {
  const all = active(s).filter((c) => c.fit?.status === "Scored");
  const sc = keys ? all.filter((c) => keys.includes(c.key)) : all;
  // Wikipedia lookups run 4 at a time (Wikimedia asks for modest concurrency); Qloo calls stay in QlooClient's queue.
  const queue = [...sc];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try { c.views = await deps.views(c.match!.matchedTitle ?? c.input.title, c.match!.matchedYear); }
      catch { c.views = { error: "pageviews lookup failed" }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  let best: AgentComp | undefined;
  for (const c of all) if (typeof c.views?.views === "number" && (!best || c.views.views < best.views!.views!)) best = c;
  s.leastViewed = best?.key; s.pageviewsVersion = s.deckVersion;
  return sc.map((c) => ({ title: c.match!.matchedTitle, article: c.views?.article, views: c.views?.views }));
}

/**
 * Closer look at one comp's Qloo tags against the rest of the deck. Uses the tags on the record that
 * /search already returned, so it makes no new Qloo call. Counts are by tag ID.
 */
/** Recorded runs only: this comp's tag look isn't in the recording for the current deck make-up (a gap). */
export function tagsNotRecorded(s: AgentState, key: string): boolean {
  const c = s.comps.find((x) => x.key === key)!;
  const rec = c.match?.recordedTagLooks;
  if (!rec) return false;
  return !(deckKey(active(s).filter((o) => o.key !== key && o.fit?.status === "Scored").map((o) => o.match?.matchedTitle ?? o.input.title)) in rec);
}

export function tagLookTool(s: AgentState, key: string): TagLook {
  const c = s.comps.find((x) => x.key === key)!;
  const rec = c.match?.recordedTagLooks;
  if (rec) {
    const k = deckKey(active(s).filter((o) => o.key !== key && o.fit?.status === "Scored").map((o) => o.match?.matchedTitle ?? o.input.title));
    const look = rec[k] ?? { totalTags: 0, sharedWithDeck: 0, uniqueCount: 0 }; // not recorded for this make-up: no note
    c.tagLook = look;
    return look;
  }
  const mine = c.match?.recordTags ?? [];
  const others = new Set(active(s).filter((o) => o.key !== key && o.fit?.status === "Scored").flatMap((o) => (o.match?.recordTags ?? []).map((t) => t.tagId)));
  const unique = mine.filter((t) => !others.has(t.tagId));
  const look: TagLook = {
    totalTags: mine.length,
    sharedWithDeck: mine.length - unique.length,
    uniqueCount: unique.length,
    uniqueGenre: unique.find((t) => /genre/.test(t.type))?.name,
    uniqueKeyword: unique.find((t) => /keyword/.test(t.type))?.name,
  };
  c.tagLook = look;
  return look;
}

/** Order-free key for a set of comps (by matched title), used to look up recorded deck make-ups. */
export function deckKey(titles: string[]): string {
  return [...titles].sort().join(" | ");
}

/** Thrown when a search couldn't reach Qloo; the stream shows its message as a plain error, never a verdict. */
export class QlooUnavailable extends Error { constructor(m: string) { super(m); this.name = "QlooError"; } }

/** Plain words for why Qloo couldn't answer. */
import { CANT_REACH, QUOTA_USED_UP } from "./messages";
export { CANT_REACH, QUOTA_USED_UP };
export function qlooUnavailableMessage(e: unknown): string {
  return e instanceof QlooError && e.kind === "quota" ? QUOTA_USED_UP : CANT_REACH;
}
