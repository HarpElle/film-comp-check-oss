import type { CutLabel, RankInfo } from "./flag";
export interface CompInput {
  title: string;
  year?: number;
  director?: string;
}

export type MatchBadge = "Matched" | "Unmatched";
/** One Qloo movie record a comp could mean (error copy item 4: "options with year and type"). */
export interface MatchOption { title: string; year?: number; type: "Film" }
export type ScoreStatus = "Scored" | "Unscored" | "Not run";

export interface MatchResult {
  input: CompInput;
  badge: MatchBadge;
  entityId?: string;
  matchedTitle?: string;
  matchedYear?: number;
  directorInRecord?: string; // the record's director credit as written (or the part of the deck's name the record contains)
  directorFromDeck?: string; // the pasted deck's director, shown beside it only when the record has no full credit // director name the user gave, confirmed present in the record
  yearRule?: "exact" | "within1";
  warning?: string; // pre-check warning (warn only)
  /** No year given and records with this exact title come from different years: each record, first (the one used) first. */
  options?: MatchOption[];
  recordTags?: { name: string; tagId: string; type: string }[]; // server-side only, stripped from results
  /** Recorded samples only: the tag look per deck make-up (key: deckKey of the other scored comps), instead of the tag list. Server-side only. */
  recordedTagLooks?: Record<string, { totalTags: number; sharedWithDeck: number; uniqueCount: number; uniqueGenre?: string; uniqueKeyword?: string }>;
  reason: string;
}

export interface DeckFitRow {
  key: string; // stable comp key (index-based)
  entityId: string;
  status: ScoreStatus;
  affinity?: number;
  http?: number;
  error?: string;
}

export interface SkewRow {
  key: string;
  female?: number;
  age?: number;
  error?: string;
}

export interface CompResult {
  key: string;
  match: MatchResult;
  fit?: DeckFitRow;
  skew?: SkewRow;
  views?: { article?: string; views?: number; error?: string };
  considerCutting: boolean; // true for the lowest comp when the rule gives a label (either label)
  cutLabel?: CutLabel;
  rank?: RankInfo;
  skewFlag?: { dFemale: number; dAge: number; direction: string; label: "Qloo's estimate" }; // k = 1 outlier only
  skewSplit?: boolean; // one of the k >= 2 split comps
  skewUnavailable?: boolean; // no audience estimate this run: not in the deck mean, the label or the map
  leastViewed: boolean;
  agentStatus?: "active" | "dropped" | "set_aside";
  setAsideWhy?: string;
  tagNote?: string; // Qloo tag note added by a chosen closer look (guarded)
  reasons: string[]; // Why lines as shown on screen (3 decimals)
  reasonsExport?: string[]; // the same lines at export precision (6 decimals)
  audienceExport?: AudienceExport; // export only: computed skew values at 3 decimals, guarded; blank strings when unavailable
}

export type AgentAction =
  | "resolve_comps" | "drop_comp" | "set_aside_comp" | "score_deck" | "rerun"
  | "skew" | "pageviews" | "rank_deck" | "flag_consider_cutting" | "flag_skew" | "tag_look" | "stop" | "finish";

/** core = always runs (code). model = the model chose it. stub = the stub provider chose it. template = model's choice failed checks twice, code's fallback. */
export type StepOrigin = "core" | "model" | "stub" | "template";

export interface AgentStep {
  n: number;
  action: AgentAction;
  comp?: string; // comp key
  reason: string; // rendered from the provider's structured reason, checked by the guard
  claims?: { sourceId: string; field: string; value: string | number; fmt: string }[];
  outcome?: string; // written by code from the tool output
  details?: string[]; // per-comp detail, shown on expand
  rejected?: string; // guard or rule rejection; the step was not executed
  note?: { comp: string; text: string }; // a Why-line note this step added to a comp (guarded)
  origin?: StepOrigin;
  choice?: { label: string; basis?: { sourceId: string; field: string; phrase: string; value: string } };
}

export interface AgentStats {
  provider: string;
  model?: string; // requested model id (config)
  responseModel?: string; // the model field of the Anthropic response, stored per run
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  calls: number; // model API calls
  rejectionsAttempted: number; // guard or rule rejections of model output (never shown as steps)
  rejections: string[]; // their reasons, for the run report only
  apiErrors: number; // model API failures (not guard rejections); each item falls back to the template
  fallbacks: number; // template steps
  choices: string[]; // chosen step sequence
  capHit?: "max_tokens" | "max_choices";
  screenChanged: boolean; // a chosen step added Qloo-sourced content outside the log
  callMs: number[]; // wall time of each model call
  coreDoneMs?: number; // run start to core done (verdict and table final)
  totalMs?: number;
  parallelTurns?: number; // turns where the model made several picks at once
  prewarmCalls?: number;
  prewarmFailed?: boolean;
}

export interface CheckResult {
  skewThresholdExport?: string; // the outlier threshold from lib/skew.ts SKEW_THRESHOLD, 3 decimals, guarded
  deckAudienceExport?: { meanFemale: string; meanAge: string }; // all-comps means the gaps use, 3 decimals, Qloo's estimate
  comps: CompResult[];
  considerCutting?: string; // key of the lowest comp when labeled
  cutLabel?: CutLabel;
  cutGap?: number;
  cutSpread?: number;
  verdictLines?: string[];
  verdict?: string; // built by code from tool outputs, checked by the fact guard
  verdictRejected?: string;
  matchSummary?: string;
  cachedAt?: string; // oldest cache entry used this run (ISO)
  tieBrokenByInputOrder?: string[];
  deckMean?: { female: number; age: number };
  /** Served from a recorded sample (no live Qloo calls): when the Qloo values were recorded; replay when the model steps are replayed too. */
  recorded?: { deck: string; at: string; replay?: { model?: string; at: string } };
  /** Audience check coverage: estimates asked for, received, and the comps without one (titles, deck order). */
  audience?: { attempted: number; available: number; unavailable: string[] };
  pickIsLeastViewed?: boolean;
  qlooCalls: number;
  cacheHits: number;
  ranAt: string;
  notes: string[];
  steps?: AgentStep[];
  provider?: string;
  stoppedBy?: "finish" | "max_steps" | "max_tokens" | "rejections";
  tokensUsed?: number;
  agentStats?: AgentStats;
  providerLabel?: string; // "stub", or the model name when the provider is Claude and the pass bars held
  /** "Run live on Qloo" on a sample: this run made live Qloo calls; compared with the recording (or, client side, with the first live run). */
  liveSample?: { sampleId: string; second: boolean; recordedAt: string; compare?: import("./compare").LiveCompare };
}

/** Export-only audience fields, all Qloo's estimate, rendered at 3 decimals through the guard. */
export interface AudienceExport { female: string; age: string; distance: string; largerGap: string; dAge: string; dFemale: string; ageDirection: string; note?: string }
export const AUDIENCE_COLUMNS: [keyof AudienceExport, string][] = [
  ["female", "female lean"], ["age", "age lean"], ["distance", "skew distance, max of |age gap| and |female gap|"], ["largerGap", "larger gap"],
  ["dAge", "age gap vs deck mean"], ["dFemale", "female gap vs deck mean"], ["ageDirection", "age direction"],
];

export const FIXED_LINE = "This checks comps. It does not predict box office or revenue.";
