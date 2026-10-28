import { CLOSE_CALL, CONSIDER_CUTTING, MIN_SCORED_FOR_LABEL } from "./flag";
import { formatValue, guardStructured, render, say, type Claim, type Fmt, type Structured } from "./claims";
import { compLabel, sourcesFromState } from "./sources";
import { SKEW_THRESHOLD } from "./skew";
import {
  active, dropComp, initialState, pageviewsTool, rankDeck, resolveComps, resolveSummaryLine, scoreDeck, setAsideComp, skewTool, tagLookTool, tagsNotRecorded,
  type AgentState, type ToolDeps,
} from "./tools";
import type { AgentAction, AgentStats, AgentStep, CompInput } from "./types";

/* ------------------------------------------------------------------ */
/* Model interface                                                     */
/* ------------------------------------------------------------------ */

/**
 * Code always runs the fixed core (resolve, leave-one-out fit, audience estimate, locked labels).
 * After the core, a provider picks next steps from an open tool set. It never computes or edits a
 * score. Every choice names the Qloo value it was based on (basis) and gives a one-line reason whose
 * numbers and names are claims (sourceId + field); code fills the values from the tool results.
 */
export type ChoiceTool = "check_pageviews" | "look_at_tags" | "rerun_after_set_aside" | "stop";
export interface ClaimRef { sourceId: string; field: string; kind?: "name" | "number" }
export interface ChoiceReason { template: string; claims: ClaimRef[] }
export interface Choice { tool: ChoiceTool; comps?: string[]; comp?: string; basis?: ClaimRef; reason: ChoiceReason }
export interface ChoiceUsage { input: number; output: number; cacheCreation: number; cacheRead: number; model?: string /* from the API response */ }
export interface ChoiceView {
  sources: Record<string, Record<string, unknown>>; // Qloo-based tool results by stable ID
  comps: { label: string; title: string; scored: boolean; pageviewsChecked: boolean; tagsChecked: boolean }[];
  tools: ChoiceTool[]; // tools available right now
  chosen: string[]; // labels of steps chosen so far
  choicesLeft: number;
}
/** lastOutcome: what the previous accepted choice did. rejection: why the previous answer was refused (retry once). */
export interface ChoiceFeedback { results?: string[] /* one per tool call of the last answer: outcome or refusal */; rejection?: string /* the whole answer was refused */ }
export interface ModelProvider {
  readonly name: string;
  readonly model?: string;
  readonly origin: "model" | "stub";
  chooseNext(view: ChoiceView, feedback: ChoiceFeedback): Promise<{ choice?: Choice; choices?: Choice[]; usage?: ChoiceUsage; error?: string }>;
  /** Optional: warm the provider's prompt cache while the core runs (no choice is made). */
  prewarm?(): Promise<ChoiceUsage | undefined>;
}

export interface SpendCap { maxSteps: number; maxTokens: number; maxChoices: number }

export function defaultCap(nComps: number): SpendCap {
  const envSteps = parseInt(process.env.AGENT_MAX_STEPS ?? "", 10);
  const envTokens = parseInt(process.env.AGENT_MAX_TOKENS ?? "", 10);
  const envChoices = parseInt(process.env.AGENT_MAX_CHOICES ?? "", 10);
  return {
    maxSteps: Number.isFinite(envSteps) ? envSteps : 4 * nComps + 12,
    maxTokens: Number.isFinite(envTokens) ? envTokens : 30_000, // per run: all input (uncached, cache writes, cache reads) + output
    maxChoices: Number.isFinite(envChoices) ? envChoices : 4,
  };
}

/** How each field is shown, and in plain words. Basis must come from a Qloo-based source. */
export const FIELD_FMT: Record<string, Fmt> = {
  affinity: "f3", dAge: "abs3", dFemale: "abs3", distance: "f3", age: "f3", female: "f3", gap: "f3", gapToNext: "f3",
  spread: "f3", lowestScore: "f3", secondScore: "f3", rank: "int", of: "int", matched: "int", total: "int", k: "int",
  views: "thousands", sharedWithDeck: "int", totalTags: "int", uniqueCount: "int", scored: "int", minScored: "int", skewThreshold: "num",
};
const FIELD_PHRASE: Record<string, string> = {
  affinity: "fit score", dAge: "audience gap", distance: "audience gap", dFemale: "audience gender gap", age: "age lean",
  female: "female lean", gap: "gap to next", gapToNext: "gap to next", spread: "spread of the rest", lowestScore: "lowest fit",
  rank: "rank", matched: "matched comps", k: "audience standouts", sharedWithDeck: "shared tags", uniqueCount: "tags only on this comp",
  label: "fit label", direction: "audience direction", outlier: "audience outlier", totalTags: "tags",
};
const QLOO_SOURCE = /^(deckfit:|skew:|rank:|rank_deck$|tags:|count:matched$)/;
export const fmtFor = (field: string): Fmt => FIELD_FMT[field] ?? "text";

/* ------------------------------------------------------------------ */
/* Stub provider: the code rules, deterministic                        */
/* ------------------------------------------------------------------ */

const title = (s: Readonly<AgentState>, key: string) => {
  const c = s.comps.find((x) => x.key === key)!;
  return c.match?.matchedTitle ?? c.input.title;
};

interface CoreStep { action: AgentAction; comp?: string; reason: Structured }

/** The fixed core, in order. Plain code; no provider can skip, reorder or change these steps. */
function coreDecide(s: Readonly<AgentState>): CoreStep {
  {
    const id = (key: string) => compLabel(s, key);
    if (s.comps.some((c) => c.state === "pending")) return { action: "resolve_comps", reason: say("Match each comp to a Qloo movie record.").done() };
    const unmatched = s.comps.find((c) => c.state === "active" && c.match?.badge === "Unmatched");
    if (unmatched) return { action: "drop_comp", comp: unmatched.key, reason: say().quoted(`resolve:${id(unmatched.key)}`, "title", unmatched.input.title).text(" is Unmatched, so it cannot be scored.").done() };
    const thin = s.comps.find((c) => c.state === "active" && c.match?.warning);
    if (thin) return { action: "set_aside_comp", comp: thin.key, reason: say().quoted(`resolve:${id(thin.key)}`, "matchedTitle", title(s, thin.key)).text(" has a Qloo record with no popularity and no tags.").done() };
    if (s.scoredVersion !== s.deckVersion) {
      return s.scoredVersion < 0
        ? { action: "score_deck", reason: say("All comps are resolved; score each one against the others.").done() }
        : { action: "rerun", reason: say("The deck changed after the last scoring, so score it again.").done() };
    }
    const unscored = s.comps.find((c) => c.state === "active" && c.fit?.status === "Unscored");
    if (unscored) {
      const src = `deckfit:${id(unscored.key)}`;
      const r = say().quoted(src, "title", title(s, unscored.key)).text(" came back Unscored from Qloo");
      if (unscored.fit?.http) r.text(" (HTTP ").claim(src, "http", unscored.fit.http, "int").text(")");
      return { action: "set_aside_comp", comp: unscored.key, reason: r.text(".").done() };
    }
    if (s.skewVersion !== s.deckVersion) return { action: "skew", reason: say("Scores are final; get Qloo audience estimates for the scored comps.").done() };
    if (s.rankVersion !== s.deckVersion) return { action: "rank_deck", reason: say("Rank the scored comps and apply the locked lowest-fit label rule.").done() };
    if (!s.cutFlagged) {
      const f = s.flag!;
      if (!f.label || !f.lowest) return { action: "flag_consider_cutting", reason: say("Fewer than ").claim("rule", "minScored", MIN_SCORED_FOR_LABEL, "int").text(" comps are scored, so there is no lowest-fit label.").done() };
      const r = f.ranks[f.lowest];
      const rk = `rank:${id(f.lowest)}`;
      const reason = say().quoted("rank_deck", "lowest", title(s, f.lowest))
        .text(" ranks ").claim(rk, "rank", r.rank, "int").text(" of ").claim(rk, "of", r.of, "int")
        .text(" at ").claim("rank_deck", "lowestScore", f.lowestScore!, "f3")
        .text(", ").claim("rank_deck", "gap", f.gap!, "f3").text(" below the next comp; the rest spread ")
        .claim("rank_deck", "spread", f.spread!, "f3").text(", so: ").claim("rank_deck", "label", f.label).text(".");
      return { action: "flag_consider_cutting", comp: f.lowest, reason: reason.done() };
    }
    if (!s.skewFlagged) {
      const o = s.skewOutlier;
      if (s.skewSplit) {
        const r = say("Audience split: ");
        s.skewSplit.forEach((k, i) => {
          if (i > 0) r.text(i === s.skewSplit!.length - 1 ? " and " : ", ");
          r.quoted(`skew:${id(k)}`, "title", title(s, k));
        });
        return { action: "flag_skew", reason: r.text(" are each more than ").claim("rule", "skewThreshold", SKEW_THRESHOLD, "num").text(" from the deck mean, so no single outlier (Qloo's estimate).").done() };
      }
      if (!o && s.skewUnavailable?.length) return { action: "flag_skew", reason: say("Audience check incomplete: ").claim("skew:deck", "missing", s.skewUnavailable.length, "int").text(" of ").claim("skew:deck", "attempted", s.skewAttempted ?? 0, "int").text(" comps had no estimate, so no audience label.").done() };
      if (!o) return { action: "flag_skew", reason: say("No comp is more than ").claim("rule", "skewThreshold", SKEW_THRESHOLD, "num").text(" from the deck mean on either audience score.").done() };
      return {
        action: "flag_skew", comp: o.key,
        reason: say().quoted("skew:deck", "outlier", title(s, o.key)).text(" is furthest from the deck mean: age gap ").claim("skew:deck", "dAge", o.dAge, "abs3")
          .text(", gender gap ").claim("skew:deck", "dFemale", o.dFemale, "abs3").text(". Over ").claim("rule", "skewThreshold", SKEW_THRESHOLD, "num").text(", so: ").claim("skew:deck", "direction", o.direction).text(" audience, Qloo's estimate.").done(),
      };
    }
    return { action: "finish", reason: say("Every comp is resolved, scored or set aside, and flagged.").done() };
  }
}

/** The stub picks deterministically: pageviews for every scored comp not yet checked, then stop. */
export class StubProvider implements ModelProvider {
  readonly name = "stub";
  readonly origin = "stub" as const;
  async chooseNext(view: ChoiceView): Promise<{ choice: Choice }> {
    return { choice: stubChoice(view) };
  }
}

/**
 * Used only when the model can't run (no key) and a recorded sample deck is re-scored without one comp: the
 * Qloo values come from the recording, and every choice falls back to the deterministic template, tagged
 * "Template" on screen. It never claims a model chose anything.
 */
export class TemplateProvider implements ModelProvider {
  readonly name = "template";
  readonly origin = "model" as const;
  async chooseNext(): Promise<{ choice?: Choice; error?: string }> {
    throw new Error("Claude isn't available for this re-score");
  }
}

export function stubChoice(view: ChoiceView): Choice {
  const todo = view.comps.filter((c) => c.scored && !c.pageviewsChecked).map((c) => c.label);
  if (todo.length && view.tools.includes("check_pageviews")) {
    return { tool: "check_pageviews", comps: todo, basis: { sourceId: "count:matched", field: "matched" }, reason: { template: "Check Wikipedia popularity for every scored comp as context.", claims: [] } };
  }
  const basis = typeof view.sources.rank_deck?.gap === "number" ? { sourceId: "rank_deck", field: "gap" } : { sourceId: "count:matched", field: "matched" };
  return { tool: "stop", basis, reason: { template: "The core results are in and popularity is checked, so stop.", claims: [] } };
}


/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

export interface AgentRun {
  state: AgentState;
  steps: AgentStep[];
  stoppedBy: "finish" | "max_steps" | "max_tokens" | "rejections";
  tokensUsed: number;
  provider: string;
  stats: AgentStats;
  verdict?: string;
  verdictLines?: string[];
  verdictClaims?: Claim[];
  verdictRejected?: string;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") { Object.values(o as object).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

/** Checks that an action is allowed by the code rules before it runs. Returns a rejection or undefined. */
function ruleCheck(s: AgentState, d: CoreStep): string | undefined {
  const c = d.comp ? s.comps.find((x) => x.key === d.comp) : undefined;
  if (d.comp && !c) return "unknown comp";
  switch (d.action) {
    case "resolve_comps": return s.comps.some((x) => x.state === "pending") ? undefined : "nothing to resolve";
    case "drop_comp": return c?.state === "active" && c.match?.badge === "Unmatched" ? undefined : "only Unmatched comps can be dropped";
    case "set_aside_comp": return c?.state === "active" && (c.fit?.status === "Unscored" || !!c.match?.warning) ? undefined : "only Unscored or thin comps can be set aside";
    case "score_deck": return s.scoredVersion < 0 ? undefined : "deck already scored; use rerun";
    case "rerun": return s.scoredVersion >= 0 ? undefined : "nothing to rerun yet";
    case "skew": case "pageviews": case "rank_deck": return s.scoredVersion === s.deckVersion ? undefined : "scores are stale; rerun first";
    case "flag_consider_cutting": {
      if (s.rankVersion !== s.deckVersion || !s.flag) return "rank is stale; run rank_deck first";
      if (d.comp !== s.flag.lowest) return "that is not the lowest-scoring comp";
      const text = render(d.reason);
      if (s.flag.label && !text.includes(s.flag.label)) return `reason must use the rule's label "${s.flag.label}"`;
      const other = s.flag.label === CONSIDER_CUTTING ? CLOSE_CALL : CONSIDER_CUTTING;
      if (text.includes(other)) return `reason uses "${other}" but the rule gives "${s.flag.label ?? "no label"}"`;
      return undefined;
    }
    case "flag_skew":
      if (s.skewVersion !== s.deckVersion) return "skew is stale; run skew first";
      return d.comp === s.skewOutlier?.key ? undefined : "that is not the skew outlier";
    case "finish": return undefined;
  }
}

/** Live progress for streaming. "started" fires after the guard passes and before the tool runs. */
export type AgentEvent = { type: "step"; phase: "started" | "done"; step: AgentStep } | { type: "core_done"; run: AgentRun };
export type AgentEventSink = (e: AgentEvent) => void;

export async function runAgent(inputs: CompInput[], deps: ToolDeps, provider: ModelProvider = new StubProvider(), cap: SpendCap = defaultCap(inputs.length), onEvent?: AgentEventSink): Promise<AgentRun> {
  const emit = (phase: "started" | "done", step: AgentStep) => {
    if (!onEvent) return;
    try { onEvent({ type: "step", phase, step: structuredClone(step) }); } catch { /* a listener must never break a run */ }
  };
  const s = initialState(inputs);
  const steps: AgentStep[] = [];
  const stats: AgentStats = {
    provider: provider.name, model: provider.model, tokensIn: 0, tokensOut: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    calls: 0, rejectionsAttempted: 0, rejections: [], apiErrors: 0, fallbacks: 0, choices: [], screenChanged: false, callMs: [],
  };
  const t0 = Date.now();
  // Warm the model's prompt cache while the core runs. It makes no choice and cannot see the core results.
  const warm = (provider.prewarm ? provider.prewarm().then((u) => {
    if (!u) return;
    stats.prewarmCalls = (stats.prewarmCalls ?? 0) + 1;
    stats.tokensIn += u.input; stats.tokensOut += u.output; stats.cacheCreationTokens += u.cacheCreation; stats.cacheReadTokens += u.cacheRead;
  }).catch(() => { stats.prewarmFailed = true; }) : Promise.resolve());
  let stoppedBy: AgentRun["stoppedBy"] = "max_steps";
  const push = (st: Omit<AgentStep, "n">) => { const step = { n: steps.length + 1, ...st } as AgentStep; steps.push(step); return step; };

  /* ---- 1. Fixed core: always runs, plain code ---- */
  let coreDone = false;
  while (steps.length < cap.maxSteps) {
    const d = coreDecide(s);
    if (d.action === "finish") { coreDone = true; break; }
    const bad = guardStructured(d.reason, sourcesFromState(s)) ?? ruleCheck(s, d);
    if (bad) throw new Error(`core step ${d.action} failed its own check: ${bad}`); // code bug, never a model issue
    const step = push({ action: d.action, comp: d.comp, reason: safeRender(d.reason), claims: d.reason.claims, origin: "core" });
    emit("started", step);
    await runCore(s, d, step, deps);
    emit("done", step);
  }

  /* Verdict: built from the core only, so it is final here and never changes after the chosen steps. */
  let verdict: string | undefined, verdictRejected: string | undefined, verdictClaims: Claim[] | undefined, verdictLines: string[] | undefined;
  if (coreDone) {
    const lines = buildVerdict(s);
    const src = sourcesFromState(s);
    verdictRejected = lines.map((l) => guardStructured(l, src)).find(Boolean);
    if (!verdictRejected) { verdictLines = lines.map(render); verdict = verdictLines.join(" "); verdictClaims = lines.flatMap((l) => l.claims); }
    stats.coreDoneMs = Date.now() - t0;
    if (onEvent) {
      const snap: AgentRun = { state: structuredClone(s), steps: structuredClone(steps), stoppedBy: "finish", tokensUsed: 0, provider: provider.name, stats: structuredClone(stats), verdict, verdictLines, verdictClaims, verdictRejected };
      try { onEvent({ type: "core_done", run: snap }); } catch { /* never break a run */ }
    }
  }

  /* ---- 2. Chosen steps: the provider picks from the open set, possibly several per turn ---- */
  if (coreDone) {
    // The prewarm is not awaited: on a cold run it finished during the core; on a cached run the first call just reads the cache.
    let feedback: ChoiceFeedback = {};
    let accepted = 0;
    while (steps.length < cap.maxSteps - 1) {
      if (accepted >= cap.maxChoices) { stats.capHit = "max_choices"; break; }
      if (stats.tokensIn + stats.tokensOut + stats.cacheCreationTokens + stats.cacheReadTokens >= cap.maxTokens) { stats.capHit = "max_tokens"; break; }
      const left = cap.maxChoices - accepted;
      let batch: Choice[] = [];
      let replies: string[] = []; // per tool call in the last answer: "" when accepted, else the refusal
      let origin: "model" | "stub" | "template" = provider.origin;
      for (let attempt = 0; attempt < 2 && !batch.length; attempt++) {
        const view = choiceView(s, stats.choices, left);
        let r: Awaited<ReturnType<ModelProvider["chooseNext"]>>;
        let apiError = false;
        const c0 = Date.now();
        try { r = await provider.chooseNext(view, feedback); } catch (e) { if (e instanceof Error && e.name === "AgentBudgetError") throw e; r = { error: e instanceof Error ? e.message : "provider error" }; apiError = true; }
        if (provider.origin === "model") stats.callMs.push(Date.now() - c0);
        if (r.usage) {
          stats.calls++;
          stats.tokensIn += r.usage.input; stats.tokensOut += r.usage.output;
          stats.cacheCreationTokens += r.usage.cacheCreation; stats.cacheReadTokens += r.usage.cacheRead;
          if (r.usage.model) stats.responseModel = r.usage.model;
        }
        if (apiError) { stats.apiErrors++; stats.rejections.push(`api: ${r.error}`); break; } // API/config failure: template, no retry
        const choices = r.choices ?? (r.choice ? [r.choice] : []);
        if (r.error || !choices.length) {
          const bad = r.error ?? "no choice";
          stats.rejectionsAttempted++; stats.rejections.push(bad);
          feedback = { rejection: bad };
          continue;
        }
        replies = [];
        const ok: Choice[] = [];
        for (const ch of choices) {
          let bad = checkChoice(s, ch, ok);
          if (!bad && ok.length >= left) bad = "choice limit reached; not run";
          if (!bad && ok.some((o) => o.tool === "stop")) bad = "stop was already chosen in this turn; not run";
          if (bad) { stats.rejectionsAttempted++; stats.rejections.push(bad); replies.push(`Refused: ${bad}. Nothing ran.`); } else { ok.push(ch); replies.push(""); }
        }
        batch = ok;
        if (!batch.length) feedback = { results: replies };
      }
      if (!batch.length) {
        // Refused twice (or the API failed): deterministic template choice for this item. Counted, never shown.
        batch = [stubChoice(choiceView(s, stats.choices, left))];
        origin = provider.origin === "stub" ? "stub" : "template";
        if (origin === "template") stats.fallbacks++;
        replies = [""];
      }
      // A re-run goes first and alone (it rescores); independent picks run concurrently; a stop runs last.
      const made = [...batch].sort((a, b) => order(a) - order(b)).map((ch) => ({ ch, step: push({ ...choiceStep(s, ch), origin }) }));
      for (const m of made) { stats.choices.push(m.step.choice!.label); emit("started", m.step); }
      const runOne = async (m: (typeof made)[number]) => { await runChoice(s, m.ch, m.step, deps, stats); emit("done", m.step); };
      for (const m of made.filter((x) => x.ch.tool === "rerun_after_set_aside")) await runOne(m);
      await Promise.all(made.filter((x) => x.ch.tool === "check_pageviews" || x.ch.tool === "look_at_tags").map(runOne));
      for (const m of made.filter((x) => x.ch.tool === "stop")) await runOne(m);
      // Tell the provider what each of its calls did, in its own order.
      let k = 0;
      feedback = { results: replies.map((rep) => rep || made.find((m) => m.ch === batch[k++])?.step.outcome || "Done.") };
      accepted += batch.length;
      if (batch.length > 1) stats.parallelTurns = (stats.parallelTurns ?? 0) + 1;
      if (batch.some((c) => c.tool === "stop")) break;
    }
    const step = push({ action: "finish", reason: "Every comp is resolved, scored or set aside, and flagged.", claims: [], origin: "core" });
    s.finished = true; stoppedBy = "finish"; step.outcome = "Done.";
    emit("started", step); emit("done", step);
  }
  await warm;
  stats.totalMs = Date.now() - t0;
  const tokensUsed = stats.tokensIn + stats.tokensOut;
  return { state: s, steps, stoppedBy, tokensUsed, provider: provider.name, stats, verdict, verdictLines, verdictClaims, verdictRejected };
}

const order = (c: Choice) => (c.tool === "rerun_after_set_aside" ? 0 : c.tool === "stop" ? 2 : 1);

async function runCore(s: AgentState, d: CoreStep, step: AgentStep, deps: ToolDeps): Promise<void> {
  switch (d.action) {
    case "resolve_comps": {
      await resolveComps(s, deps);
      step.outcome = resolveSummaryLine(s.resolveSummary!);
      step.details = s.comps.map((c) => {
        const m = c.match!;
        return m.badge === "Matched"
          ? `${c.input.title}: matched ${m.matchedTitle} (${m.matchedYear ?? "?"})${m.directorInRecord ? `, record names ${m.directorInRecord}` : ""}${m.directorFromDeck ? `; deck lists ${m.directorFromDeck}` : ""}${m.warning ? ". Thin record." : ""}`
          : `${c.input.title}: unmatched. ${m.reason}`;
      });
      break;
    }
    case "drop_comp": dropComp(s, d.comp!); step.outcome = "Dropped from the deck."; break;
    case "set_aside_comp": {
      const c = s.comps.find((x) => x.key === d.comp)!;
      setAsideComp(s, d.comp!, c.fit?.status === "Unscored" ? "Qloo returned no fit score" : "thin Qloo record (no popularity, no tags)");
      step.outcome = "Set aside; the deck will be rescored without it.";
      break;
    }
    case "score_deck": case "rerun": {
      await scoreDeck(s, deps);
      step.outcome = scoredOutcome(s);
      break;
    }
    case "skew": await skewTool(s, deps); step.outcome = s.skewOutlier ? `Outlier: ${title(s, s.skewOutlier.key)}.` : s.skewSplit ? `Split: ${s.skewSplit.map((k) => title(s, k)).join(", ")}.` : "No outlier over 0.3."; break;
    case "rank_deck": {
      rankDeck(s);
      const f = s.flag!;
      step.outcome = f.label ? `Lowest: ${title(s, f.lowest!)}. Gap ${f.gap!.toFixed(3)}, spread ${f.spread!.toFixed(3)}: ${f.label}.` : "Fewer than 3 scored comps; no label.";
      break;
    }
    case "flag_consider_cutting": {
      s.considerCutting = s.flag?.label ? s.flag.lowest : undefined; s.tied = s.flag?.tiedLowest; s.cutFlagged = true;
      step.outcome = s.considerCutting ? `Labeled ${title(s, s.considerCutting)}: ${s.flag!.label}.` : "No label.";
      break;
    }
    case "flag_skew": s.skewFlagged = true; step.outcome = s.skewOutlier ? `Flagged ${title(s, s.skewOutlier.key)} (Qloo's estimate).` : s.skewSplit ? "Marked the split comps (Qloo's estimate)." : "No skew flag."; break;
    default: break;
  }
}

function scoredOutcome(s: AgentState): string {
  const rows = active(s).filter((c) => c.fit);
  return `${rows.filter((c) => c.fit!.status === "Scored").length} scored, ${rows.filter((c) => c.fit!.status === "Unscored").length} unscored.`;
}

/* ------------------------------------------------------------------ */
/* Choice phase helpers                                                */
/* ------------------------------------------------------------------ */

const scoredComps = (s: AgentState) => active(s).filter((c) => c.fit?.status === "Scored");

/** Only Qloo-based sources go to the provider (no Wikipedia counts as a basis; those come back as outcomes). */
export function choiceView(s: AgentState, chosen: string[], choicesLeft: number): ChoiceView {
  const sources: ChoiceView["sources"] = {};
  for (const [k, v] of sourcesFromState(s)) if (QLOO_SOURCE.test(k)) sources[k] = v;
  const tools: ChoiceTool[] = [];
  if (scoredComps(s).some((c) => !c.views)) tools.push("check_pageviews");
  // Recorded runs: a comp whose tag look isn't recorded for this make-up is a gap, not offered (shown as "Not recorded").
  if (scoredComps(s).some((c) => !c.tagLook && !tagsNotRecorded(s, c.key))) tools.push("look_at_tags");
  if (s.comps.some((c) => c.state === "set_aside")) tools.push("rerun_after_set_aside");
  tools.push("stop");
  return {
    sources,
    comps: active(s).map((c) => ({ label: compLabel(s, c.key), title: title(s, c.key), scored: c.fit?.status === "Scored", pageviewsChecked: !!c.views, tagsChecked: !!c.tagLook || tagsNotRecorded(s, c.key) })),
    tools, chosen: [...chosen], choicesLeft,
  };
}

function findComp(s: AgentState, ref: string | undefined) {
  if (!ref) return undefined;
  const r = ref.trim().toLowerCase();
  return active(s).find((c) => compLabel(s, c.key).toLowerCase() === r || title(s, c.key).toLowerCase() === r || c.input.title.toLowerCase() === r);
}

function toStructured(r: ChoiceReason, src: ReturnType<typeof sourcesFromState>): Structured {
  return {
    template: String(r.template ?? ""),
    claims: (r.claims ?? []).map((c) => ({ sourceId: String(c.sourceId), field: String(c.field), value: (src.get(String(c.sourceId))?.[String(c.field)] as string | number | undefined) ?? "", fmt: fmtFor(String(c.field)) })),
  };
}

/** Rule and guard checks on a provider's choice. Returns the rejection, or undefined when it can run. */
export function checkChoice(s: AgentState, ch: Choice, pending: Choice[] = []): string | undefined {
  const tools: ChoiceTool[] = ["check_pageviews", "look_at_tags", "rerun_after_set_aside", "stop"];
  if (!tools.includes(ch.tool)) return `unknown tool ${ch.tool}`;
  const src = sourcesFromState(s);
  if (!ch.basis) return "every choice needs a basis: the Qloo value (sourceId, field) it is based on";
  if (!QLOO_SOURCE.test(ch.basis.sourceId)) return `basis must be a Qloo result; ${ch.basis.sourceId} is not one`;
  const b = src.get(ch.basis.sourceId);
  if (!b) return `unknown source ${ch.basis.sourceId}`;
  if (!(ch.basis.field in b) || b[ch.basis.field] === undefined || ch.basis.field === "title") return `${ch.basis.sourceId} has no usable field ${ch.basis.field}`;
  if (typeof b[ch.basis.field] !== "number") return `basis must be a number from a Qloo result; ${ch.basis.sourceId}.${ch.basis.field} is not a number`;
  const reason = toStructured(ch.reason ?? { template: "", claims: [] }, src);
  if (!reason.template.trim()) return "reason is empty";
  if (render(reason).length > 200) return "reason is longer than one line";
  const g = guardStructured(reason, src);
  if (g) return g;
  const slot = checkSlots(s, ch.reason ?? { template: "", claims: [] }, reason);
  if (slot) return slot;
  switch (ch.tool) {
    case "check_pageviews": {
      if (!ch.comps?.length) return "check_pageviews needs comps";
      for (const ref of ch.comps) {
        const c = findComp(s, ref);
        if (!c || c.fit?.status !== "Scored") return `${ref} is not a scored comp`;
        if (c.views) return `${ref} pageviews already checked`;
        if (pending.some((p) => p.tool === "check_pageviews" && p.comps?.some((r) => findComp(s, r)?.key === c.key))) return `${ref} pageviews already picked in this turn`;
      }
      return undefined;
    }
    case "look_at_tags": {
      const c = findComp(s, ch.comp);
      if (!c || c.fit?.status !== "Scored") return `${ch.comp ?? "(none)"} is not a scored comp`;
      if (c.tagLook) return `${ch.comp} tags already checked`;
      if (tagsNotRecorded(s, c.key)) return `${ch.comp} tags are not recorded for this deck`;
      if (pending.some((p) => p.tool === "look_at_tags" && findComp(s, p.comp)?.key === c.key)) return `${ch.comp} tags already picked in this turn`;
      return undefined;
    }
    case "rerun_after_set_aside":
      if (pending.length) return "a re-run must be the only pick in its turn";
      return s.comps.some((c) => c.state === "set_aside") ? undefined : "no comp is set aside";
    case "stop": return undefined;
  }
}

/** Words a sentence may start with in free text. Any other capitalized word is treated as a name. */
const SENTENCE_STARTERS = new Set(("a an the this that these those its it it's both each every all no not only most more less lowest highest top best " +
  "fit fits deck audience audiences check checking look looking stop stopping popularity tags tag scores score with since as because so " +
  "one two three their there here then next also still now see get pick picking review reviewing confirm add adding skip other others " +
  "lower higher low high wide narrow tight close comp comps film films is are has have was were why what which how if when while after before " +
  "they we you i his her gap gaps spread rank ranked ranking views pageviews nothing enough further any some just none given").split(/\s+/));
const ALWAYS_OK = new Set(["Qloo", "Qloo's", "Wikipedia", "I"]);
const NAME_FIELDS = new Set(["outlier", "lowest", "title", "matchedTitle", "leastViewed"]);

/**
 * Names in free text and the slots placeholders sit in.
 * - A deck comp name in free text (title-cased whole word, case-sensitive) must be a claim instead.
 * - Any other capitalized word that is not a sentence starter is treated as a film or person name not in the deck.
 * - A slot used as a name (declared kind "name", sentence-initial, or followed by 's) must hold a deck comp name, not a number.
 * - A slot declared kind "number" must hold a number.
 */
/** All names a deck comp goes by, for the comp whose name equals v (empty if v is not a comp). */
function compNamesFor(s: AgentState, v: string): Set<string> {
  for (const c of s.comps) {
    const names = new Set([title(s, c.key), compLabel(s, c.key), c.input.title].filter(Boolean));
    if (names.has(v)) return names;
  }
  return new Set<string>();
}

export function checkSlots(s: AgentState, raw: ChoiceReason, st: Structured): string | undefined {
  const free = st.template.replace(/\{\d+\}/g, " ");
  if (/["\u201c\u201d]/.test(free)) return "free text may not quote anything; use a claim";
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const deckNames = [...new Set(s.comps.flatMap((c) => [title(s, c.key), compLabel(s, c.key), c.input.title]).filter((n) => n && n.length > 1))];
  for (const n of deckNames) {
    const titleCased = n.replace(/\b([a-z])/g, (m) => m.toUpperCase());
    for (const form of new Set([n, titleCased])) {
      for (const m of free.matchAll(new RegExp(`(^|[^A-Za-z0-9])${esc(form)}(?=[^A-Za-z0-9]|$)`, "g"))) {
        // A comp name as the first word of a sentence ("Her audience skews younger.") reads as a plain word,
        // unless that comp is claimed in the same reason; then it is a film mention outside a claim.
        const before = free.slice(0, m.index! + m[1].length).trimEnd();
        const sentenceStart = before === "" || /[.;:!?]$/.test(before);
        const claimed = st.claims.some((c) => typeof c.value === "string" && compNamesFor(s, c.value).has(n));
        if (sentenceStart && !claimed) continue;
        return `free text names ${n}; put comp names in a claim`;
      }
    }
  }
  // Remaining capitalized words: sentence starters are fine, anything else is a name that is not a deck comp.
  const sentences = free.split(/(?<=[.;:!?])\s+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "");
      if (!w || !/^[A-Z]/.test(w) || ALWAYS_OK.has(w)) continue;
      const first = i === 0 || (i === 1 && !/[A-Za-z]/.test(words[0]));
      if (first && SENTENCE_STARTERS.has(w.toLowerCase().replace(/'s$/, ""))) continue;
      return `free text names ${w}, which is not a comp in this deck`;
    }
  }
  // Slot checks.
  const t = st.template;
  for (let i = 0; i < st.claims.length; i++) {
    const c = st.claims[i];
    const declared = raw.claims?.[i]?.kind;
    const at = t.indexOf(`{${i}}`);
    const before = t.slice(0, at).trimEnd();
    const after = t.slice(at + `{${i}}`.length);
    const positional = before === "" || /[.;:!?]$/.test(before) || /^'s\b/.test(after);
    if (declared === "number" && typeof c.value !== "number") return `slot {${i}} is a number slot but ${c.sourceId}.${c.field} is not a number`;
    const isName = declared === "name" || positional || NAME_FIELDS.has(c.field);
    if (isName) {
      if (typeof c.value === "number") return `slot {${i}} is a name slot but holds a number (${c.sourceId}.${c.field}); use the comp's name`;
      const v = String(c.value);
      if (!deckNames.includes(v)) return `slot {${i}} holds ${v}, which is not a comp in this deck`;
    }
  }
  return undefined;
}

const LABEL_VERB: Record<ChoiceTool, string> = {
  check_pageviews: "pageview check", look_at_tags: "closer look", rerun_after_set_aside: "re-run after a set-aside", stop: "stop",
};

function choiceStep(s: AgentState, ch: Choice): Omit<AgentStep, "n"> {
  const src = sourcesFromState(s);
  let label: string, action: AgentAction, comp: string | undefined;
  switch (ch.tool) {
    case "check_pageviews": {
      const names = ch.comps!.map((r) => title(s, findComp(s, r)!.key));
      label = `${LABEL_VERB.check_pageviews} on ${names.join(", ")}`; action = "pageviews"; break;
    }
    case "look_at_tags": { comp = findComp(s, ch.comp)!.key; label = `closer look at ${title(s, comp)}'s tags`; action = "tag_look"; break; }
    case "rerun_after_set_aside": label = LABEL_VERB.rerun_after_set_aside; action = "rerun"; break;
    default: label = "stop"; action = "stop";
  }
  const b = ch.basis!;
  const raw = src.get(b.sourceId)![b.field] as string | number;
  const basis = { sourceId: b.sourceId, field: b.field, phrase: FIELD_PHRASE[b.field] ?? b.field, value: formatValue(raw, fmtFor(b.field)) };
  const reason = toStructured(ch.reason, src);
  return { action, comp, reason: safeRender(reason), claims: reason.claims, choice: { label, basis } };
}

async function runChoice(s: AgentState, ch: Choice, step: AgentStep, deps: ToolDeps, stats: AgentStats): Promise<void> {
  switch (ch.tool) {
    case "check_pageviews": {
      const keys = ch.comps!.map((r) => findComp(s, r)!.key);
      await pageviewsTool(s, deps, keys);
      step.outcome = keys.map((k) => {
        const v = s.comps.find((c) => c.key === k)!.views;
        return `${title(s, k)}: ${typeof v?.views === "number" ? `${v.views.toLocaleString("en-US")} Wikipedia views` : "no count"}`;
      }).join("; ") + ".";
      break;
    }
    case "look_at_tags": {
      const key = step.comp!;
      const look = tagLookTool(s, key);
      const note = tagNote(s, key);
      if (note) {
        const g = guardStructured(note, sourcesFromState(s));
        if (!g) { const text = render(note); s.comps.find((c) => c.key === key)!.tagNote = text; step.note = { comp: key, text }; stats.screenChanged = true; }
      }
      step.outcome = `Shares ${look.sharedWithDeck} of ${look.totalTags} Qloo tags with the rest of the deck${look.uniqueGenre ?? look.uniqueKeyword ? `; only on this comp: "${look.uniqueGenre ?? look.uniqueKeyword}"` : ""}.`;
      break;
    }
    case "rerun_after_set_aside": await scoreDeck(s, deps); step.outcome = scoredOutcome(s); break;
    case "stop": step.outcome = "Stopped choosing."; break;
  }
}

/** The Why-line note a closer look can add. Every value is a claim on tags:<comp>. */
export function tagNote(s: AgentState, key: string): Structured | undefined {
  const c = s.comps.find((x) => x.key === key)!;
  const t = c.tagLook;
  if (!t || !t.totalTags) return undefined;
  const id = `tags:${compLabel(s, key)}`;
  const v = say("Qloo tags: shares ").claim(id, "sharedWithDeck", t.sharedWithDeck, "int").text(" of ").claim(id, "totalTags", t.totalTags, "int").text(" with the rest of the deck");
  const uniq = t.uniqueGenre ? ["uniqueGenre", t.uniqueGenre] : t.uniqueKeyword ? ["uniqueKeyword", t.uniqueKeyword] : undefined;
  if (uniq) v.text("; only this comp is tagged \u201c").claim(id, uniq[0], uniq[1]).text("\u201d");
  return v.text(".").done();
}

function safeRender(st: Structured): string {
  try { return render(st); } catch { return "(unreadable reason)"; }
}

/**
 * Verdict, built in code from tool outputs only, as claims. Order: matched count,
 * audience line, fit line. Each line runs through the same guard as provider reasons.
 */
export function buildVerdict(s: AgentState): Structured[] {
  const lines: Structured[] = [];
  const r = s.resolveSummary;
  if (r) lines.push(say().claim("count:matched", "matched", r.matched, "int").text(" of ").claim("count:matched", "total", r.total, "int").text(" comps matched.").done());
  const id = (k: string) => compLabel(s, k);
  const missing = s.skewUnavailable?.length ?? 0, N = s.skewAttempted ?? 0, M = N - missing;
  // Incomplete audience check (same as the audience label rule): same rule and threshold over the comps that
  // have an estimate, but the line never reads as a complete result, and it says what the average covers.
  const among = (v: ReturnType<typeof say>) => v.text(" among ").claim("skew:deck", "available", M, "int").text(" of ").claim("skew:deck", "attempted", N, "int").text(" comps: ");
  const basis = () => (M > 0 ? say(" (Qloo's estimate; deck average over those ").claim("skew:deck", "available", M, "int").text(")") : say());
  if (missing > 0 && s.skewVersion >= 0) {
    if (s.skewFlagged && s.skewOutlier) {
      const o = s.skewOutlier;
      lines.push(among(say("Audience outlier")).claim("skew:deck", "outlier", title(s, o.key)).text(" brings ").claim("skew:deck", "direction", o.direction)
        .text(" audience than the other comps with an estimate").join(basis().done(), "").text(". Check it.").done());
    } else if (s.skewFlagged && s.skewSplit) {
      const v = among(say("Audience split"));
      s.skewSplit.forEach((k, i) => {
        if (i > 0) v.text(i === s.skewSplit!.length - 1 ? " and " : ", ");
        v.claim(`skew:${id(k)}`, "title", title(s, k));
      });
      lines.push(v.text(" skew differently").join(basis().done(), "").text(".").done());
    } else {
      const v = say("Audience check incomplete: ").claim("skew:deck", "missing", missing, "int").text(" of ").claim("skew:deck", "attempted", N, "int").text(" comps had no estimate");
      if (M > 0) v.text("; the deck average uses the other ").claim("skew:deck", "available", M, "int").text(" (Qloo's estimate)");
      lines.push(v.text(".").done());
    }
  } else if (s.skewFlagged && s.skewOutlier) {
    const o = s.skewOutlier;
    lines.push(say("Audience outlier: ").claim("skew:deck", "outlier", title(s, o.key)).text(" brings ").claim("skew:deck", "direction", o.direction)
      .text(" audience than the rest of your comps (Qloo's estimate). Check it.").done());
  } else if (s.skewFlagged && s.skewSplit) {
    const v = say("Audience split: ");
    s.skewSplit.forEach((k, i) => {
      if (i > 0) v.text(i === s.skewSplit!.length - 1 ? " and " : ", ");
      v.claim(`skew:${id(k)}`, "title", title(s, k));
    });
    lines.push(v.text(" skew differently (Qloo's estimate).").done());
  } else lines.push(say("No audience outlier.").done());
  const f = s.flag;
  if (s.cutFlagged && f?.label && f.lowest) {
    const v = f.label === CLOSE_CALL ? say("Fit ranking: no comp clearly stands apart. ") : say();
    v.claim("rank_deck", "label", f.label).text(": ").claim("rank_deck", "lowest", title(s, f.lowest))
      .text(" (").claim("rank_deck", "lowestScore", f.lowestScore!, "f3").text(", ").claim("rank_deck", "gap", f.gap!, "f3").text(" below the next comp).");
    lines.push(v.done());
  } else lines.push(say("No lowest-fit label (fewer than ").claim("rule", "minScored", MIN_SCORED_FOR_LABEL, "int").text(" scored comps).").done());
  return lines;
}
