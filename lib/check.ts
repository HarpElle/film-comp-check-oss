import "server-only";
import { recordingDeps } from "./record";
import { QlooClient, QlooError } from "./qloo";
import { monthlyViews, resolveArticle } from "./pageviews";
import { runAgent, defaultCap, type AgentEventSink, type AgentRun, type ModelProvider } from "./agent";
import type { AgentStep } from "./types";
import { getProvider } from "./providers";
import { deterministicReasons, type ReasonWriter } from "./reasons";
import { guardStructured, render, type Structured } from "./claims";
import { compLabel, sourcesFromState } from "./sources";
import { SKEW_THRESHOLD } from "./skew";
import { RUN_DEADLINE_MS } from "./stream";

/** The screen shows 3 decimals everywhere: fit scores claimed at 6 are rendered and guarded at 3. */
export function atScreen(st: Structured): Structured {
  return { template: st.template, claims: st.claims.map((c) => (c.fmt === "f6" ? { ...c, fmt: "f3" as const } : c)) };
}
import { resolveSummaryLine, tagsNotRecorded, type ToolDeps } from "./tools";
import { friendlyModel } from "./providers/claude";
import type { CheckResult, CompInput, CompResult, MatchResult } from "./types";

/** Events a check emits while it runs: agent steps, and the core result as soon as the core is done. */
export type CheckProgress =
  | { type: "step"; phase: "started" | "done"; step: AgentStep }
  | { type: "core_result"; result: CheckResult }
  | { type: "qloo_live" }; // the first real Qloo call of this run is about to go out (not sent for all-cache runs)
export interface CheckOptions { bypassCache?: boolean; writer?: ReasonWriter; provider?: ModelProvider; onEvent?: (e: CheckProgress) => void; onRun?: (run: import("./agent").AgentRun) => void }

export function liveDeps(q: QlooClient, bypassCache: boolean): ToolDeps {
  const wstats = { calls: 0, cacheHits: 0 };
  return {
    search: (t) => q.searchMovies(t),
    fit: async (others, target) => {
      try {
        const a = await q.deckFitAffinity(others, target);
        return a === undefined ? { http: 200, error: "empty 200" } : { affinity: a, http: 200 };
      } catch (e) {
        return { http: e instanceof QlooError ? e.status : undefined, error: e instanceof Error ? e.message : "error" };
      }
    },
    demographics: (id, o) => q.demographics(id, { parallel: true, maxRetries: 1, timeoutMs: o?.timeoutMs, signal: o?.signal }),
    views: async (title, year) => {
      const article = await resolveArticle(title, year, wstats, bypassCache);
      return article ? { article, views: await monthlyViews(article, wstats, bypassCache) } : { error: "no film article found" };
    },
  };
}

/** Record tags stay server-side; only the guarded tag note reaches the client. */
function stripTags(m: MatchResult | undefined): MatchResult | undefined {
  if (!m) return m;
  const { recordTags: _t, recordedTagLooks: _r, ...rest } = m;
  return rest;
}

/** Turn an agent run into the result the UI and export use. */
export function toCheckResult(run: AgentRun, stats: { calls: number; cacheHits: number; oldestCachedAt?: string }, writer: ReasonWriter = deterministicReasons): CheckResult {
  const s = run.state;
  const comps: CompResult[] = s.comps.map((c) => ({
    key: c.key,
    match: stripTags(c.match) ?? { input: c.input, badge: "Unmatched", reason: "Not resolved before the agent stopped." },
    fit: c.fit ?? (c.state === "set_aside" && c.match?.entityId ? { key: c.key, entityId: c.match.entityId, status: "Not run" } : undefined),
    skew: c.skew,
    views: c.views,
    considerCutting: s.cutFlagged && c.key === s.considerCutting,
    cutLabel: s.cutFlagged && c.key === s.considerCutting ? s.flag?.label : undefined,
    rank: s.flag && s.rankVersion === s.deckVersion ? s.flag.ranks[c.key] : undefined,
    skewFlag: s.skewFlagged && s.skewOutlier?.key === c.key ? { dFemale: s.skewOutlier.dFemale, dAge: s.skewOutlier.dAge, direction: s.skewOutlier.direction, label: "Qloo's estimate" } : undefined,
    skewSplit: s.skewFlagged && !!s.skewSplit?.includes(c.key),
    skewUnavailable: !!s.skewUnavailable?.includes(c.key) || undefined,
    leastViewed: c.key === s.leastViewed,
    agentStatus: c.state === "pending" ? undefined : c.state,
    setAsideWhy: c.setAsideWhy,
    tagNote: c.tagNote,
    reasons: [],
  }));
  const notes: string[] = [];
  const setAside = s.comps.filter((c) => c.state === "set_aside").length;
  if (setAside) notes.push(`${setAside} comp(s) were set aside by the agent and the rest were rescored.`);
  if (run.verdictRejected) notes.push(`Verdict withheld: the fact guard rejected it (${run.verdictRejected}).`);
  if (run.stoppedBy !== "finish") notes.push(`The agent stopped early (${run.stoppedBy}). Results may be incomplete.`);
  for (const c of run.state.comps) if (c.state === "active" && c.fit?.status === "Scored" && !c.tagLook && tagsNotRecorded(run.state, c.key)) notes.push(`Not recorded: ${c.match?.matchedTitle ?? c.input.title} tags`);
  const result: CheckResult = {
    comps,
    considerCutting: s.cutFlagged ? s.considerCutting : undefined,
    cutLabel: s.cutFlagged ? s.flag?.label : undefined,
    cutGap: s.flag?.gap,
    cutSpread: s.flag?.spread,
    verdict: run.verdict,
    verdictLines: run.verdictLines,
    verdictRejected: run.verdictRejected,
    matchSummary: s.resolveSummary ? resolveSummaryLine(s.resolveSummary) : undefined,
    cachedAt: stats.oldestCachedAt,
    tieBrokenByInputOrder: s.tied,
    deckMean: s.deckMean,
    audience: s.skewVersion >= 0 ? { attempted: s.skewAttempted ?? 0, available: (s.skewAttempted ?? 0) - (s.skewUnavailable?.length ?? 0), unavailable: (s.skewUnavailable ?? []).map((k) => s.comps.find((c) => c.key === k)!.match?.matchedTitle ?? s.comps.find((c) => c.key === k)!.input.title) } : undefined,
    pickIsLeastViewed: s.considerCutting !== undefined && s.considerCutting === s.leastViewed,
    qlooCalls: stats.calls,
    cacheHits: stats.cacheHits,
    ranAt: new Date().toISOString(),
    notes,
    steps: run.steps,
    provider: run.provider,
    stoppedBy: run.stoppedBy,
    tokensUsed: run.tokensUsed,
    agentStats: run.stats,
    // The label comes only from the API response's model field; until a response exists there is no label.
    providerLabel: run.provider === "claude" ? friendlyModel(run.stats.responseModel) : run.provider === "template" ? "Template" : run.provider,
  };
  // Why lines: each surface is rendered and guarded at its own rounding (screen 3 decimals, export 6).
  const src = sourcesFromState(s);
  const idOf = (key: string) => compLabel(s, key);
  for (const c of comps) {
    c.reasons = []; c.reasonsExport = [];
    for (const st of writer.structured(c, result, idOf)) {
      const scr = atScreen(st);
      const bad = guardStructured(scr, src) ?? guardStructured(st, src);
      if (bad) { notes.push(`A Why line for ${c.match.input.title} was withheld by the fact guard (${bad}).`); continue; }
      c.reasons.push(render(scr)); c.reasonsExport.push(render(st));
    }
  }
  // Export-only audience values: each one is a claim on the skew tool's result, guarded at 3 decimals.
  const val = (sourceId: string, field: string, value: unknown, fmt: "f3" | "text"): string => {
    if (value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value))) return "";
    const st: Structured = { template: "{0}", claims: [{ sourceId, field, value: value as string | number, fmt }] };
    return guardStructured(st, src) ? "" : render(st);
  };
  for (const c of comps) {
    const id = idOf(c.key);
    const row = s.skewLabel?.rows.find((r) => r.key === c.key);
    if (!c.skew || typeof c.skew.female !== "number" || typeof c.skew.age !== "number" || !row) {
      if (c.match.badge === "Matched" && c.skew?.error) { const u = "unavailable"; c.audienceExport = { female: u, age: u, distance: u, largerGap: u, dAge: u, dFemale: u, ageDirection: u, note: `Audience estimate unavailable: ${c.skew.error}.` }; }
      else if (c.match.badge === "Matched") c.audienceExport = { female: "", age: "", distance: "", largerGap: "", dAge: "", dFemale: "", ageDirection: "", note: "No audience estimate for this comp (not scored)." };
      continue;
    }
    c.audienceExport = {
      female: val(`skew:${id}`, "female", c.skew.female, "f3"),
      age: val(`skew:${id}`, "age", c.skew.age, "f3"),
      distance: val(`skew:${id}`, "distance", row.distance, "f3"),
      largerGap: val(`skew:${id}`, "largerGap", Math.abs(row.dAge) >= Math.abs(row.dFemale) ? "age" : "female lean", "text"), // tie goes to age
      dAge: val(`skew:${id}`, "dAge", row.dAge, "f3"),
      dFemale: val(`skew:${id}`, "dFemale", row.dFemale, "f3"),
      ageDirection: val(`skew:${id}`, "dAgeSign", row.dAge > 0 ? "older" : row.dAge < 0 ? "younger" : undefined, "text"),
    };
  }
  result.skewThresholdExport = val("rule", "skewThreshold", SKEW_THRESHOLD, "f3");
  if (s.deckMean) result.deckAudienceExport = { meanFemale: val("skew:deck", "meanFemale", s.deckMean.female, "f3"), meanAge: val("skew:deck", "meanAge", s.deckMean.age, "f3") };
  return result;
}

/** The one path every check takes, streamed or not. Deps and stats are injectable for tests. */
export async function runCheckWith(inputs: CompInput[], deps: ToolDeps, stats: { calls: number; cacheHits: number; oldestCachedAt?: string }, opts: CheckOptions = {}): Promise<CheckResult> {
  const sink: AgentEventSink | undefined = opts.onEvent && ((e) => {
    if (e.type === "core_done") opts.onEvent!({ type: "core_result", result: toCheckResult(e.run, { ...stats }, opts.writer) });
    else opts.onEvent!(e);
  });
  const run = await runAgent(inputs, deps, opts.provider ?? getProvider(), defaultCap(inputs.length), sink);
  try { opts.onRun?.(run); } catch { /* recording never breaks a run */ }
  return toCheckResult(run, stats, opts.writer);
}

export interface LiveRunInfo { qlooCalls: number; remaining?: number }
/**
 * A live run. A successful run that called Qloo is recorded under its comp list (comp: key, 30 days; comp
 * titles plus trimmed Qloo fields). onLiveDone reports the Qloo calls made and the last remaining quota seen.
 */
export async function runCheck(inputs: CompInput[], opts: CheckOptions & { onLiveDone?: (i: LiveRunInfo) => Promise<void> | void; record?: boolean; views?: ToolDeps["views"] } = {}): Promise<CheckResult> {
  // No Qloo request starts after this, so the run returns before the stream's own deadline (lib/stream.ts).
  let remaining: number | undefined;
  const q = new QlooClient({ bypassCache: opts.bypassCache, deadline: Date.now() + RUN_DEADLINE_MS - 5_000, onLive: () => opts.onEvent?.({ type: "qloo_live" }), onQuota: (r) => { remaining = r; } });
  const base = liveDeps(q, !!opts.bypassCache);
  const rec = recordingDeps(opts.views ? { ...base, views: opts.views } : base);
  let built: import("./trim").Recording | undefined;
  try {
    const r = await runCheckWith(inputs, rec.deps, q.stats, { ...opts, onRun: (run) => { opts.onRun?.(run); if (opts.record !== false) built = rec.build(run, new Date().toISOString()); } });
    if (built && q.stats.calls > 0 && r.comps.every((c) => c.match.badge !== "Matched" || c.fit?.status === "Scored")) {
      const { kv } = await import("./kv");
      await kv().putComp(inputs, built);
    }
    return r;
  } finally {
    try { await opts.onLiveDone?.({ qlooCalls: q.stats.calls, remaining }); } catch { /* pacing never breaks a run */ }
  }
}

/** A recorded sample: the same agent loop over recorded Qloo values (zero Qloo calls); the provider still runs live. */
export async function runSampleCheck(fx: import("./samples").SampleFixture, inputs: CompInput[], opts: CheckOptions = {}): Promise<CheckResult> {
  const { sampleDeps } = await import("./samples");
  const recorded = { deck: fx.label, at: fx.recordedAt };
  const on = opts.onEvent && ((e: CheckProgress) => opts.onEvent!(e.type === "core_result" ? { ...e, result: { ...e.result, recorded } } : e));
  const r = await runCheckWith(inputs, sampleDeps(fx), { calls: 0, cacheHits: 0 }, { ...opts, onEvent: on });
  return { ...r, recorded, cachedAt: undefined };
}
