import type { CheckResult, CompInput, MatchResult } from "./types";

/**
 * Whitelists for everything Qloo-derived that goes into the store. Each function builds a new object from
 * the fields the app uses, so a raw Qloo response (or anything else) passed in comes out trimmed: no
 * response bodies, entity IDs, tag lists or descriptions. lib/kv.ts runs every write through one of these.
 */
export const RECORDING_SCHEMA = "film-comp-check/sample@1";
export const REPLAY_SCHEMA = "film-comp-check/replay@1";
/** Largest JSON entry the store accepts (bytes). A trimmed six-comp recording is a few KB. */
export const MAX_ENTRY_BYTES = 96 * 1024;

export interface TagLookRec { totalTags: number; sharedWithDeck: number; uniqueCount: number; uniqueGenre?: string; uniqueKeyword?: string }
export type RecordedMatch = Omit<MatchResult, "input" | "entityId" | "recordTags" | "recordedTagLooks">;
export interface RecordedComp {
  input: CompInput;
  match: RecordedMatch;
  audience: { female: number; age: number } | null;
  views: { article?: string; views?: number; error?: string };
  /** key: deckKey(matched titles of the other scored comps) */
  tagLooks: Record<string, TagLookRec>;
}
/** A recorded Qloo run: a sample deck (sample: keys) or a custom comp list (comp: keys, 30 days). */
export interface Recording {
  schema: typeof RECORDING_SCHEMA;
  id: string;
  label: string;
  recordedAt: string;
  comps: RecordedComp[];
  /** key: deckKey(matched titles in the deck make-up); value: leave-one-out fit per matched title */
  fit: Record<string, Record<string, number>>;
}
export interface Replay { schema: typeof REPLAY_SCHEMA; id: string; recordedAt: string; model?: string; synthetic?: true; /** Titles removed from the sample deck for this make-up (a replay after Remove); absent for the full deck. */ without?: string[]; result: CheckResult }
export interface LandingSnippet { deck: string; comps: number; verdictLines: string[]; recordedAt?: string }

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const str = (x: unknown, max = 400) => (typeof x === "string" ? x.slice(0, max) : undefined);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** titleOnly: custom comp lists keep only the comp title (no year, director or other deck text). */
export function trimInput(x: unknown, titleOnly = false): CompInput {
  const i = obj(x);
  return clean({ title: str(i.title, 200) ?? "", year: titleOnly ? undefined : num(i.year), director: titleOnly ? undefined : str(i.director, 200) });
}
export function trimMatch(x: unknown, titleOnly = false): RecordedMatch {
  const m = obj(x);
  return clean({
    badge: m.badge === "Matched" ? "Matched" : "Unmatched",
    matchedTitle: str(m.matchedTitle, 200), matchedYear: num(m.matchedYear), directorInRecord: str(m.directorInRecord, 200),
    directorFromDeck: titleOnly ? undefined : str(m.directorFromDeck, 200),
    yearRule: m.yearRule === "exact" || m.yearRule === "within1" ? m.yearRule : undefined,
    options: trimOptions(m.options),
    warning: str(m.warning), reason: titleOnly ? reasonCode(str(m.reason) ?? "") : str(m.reason) ?? "",
  }) as RecordedMatch;
}
/** Several-match options: record title and year only, at most 5. */
function trimOptions(x: unknown): MatchResult["options"] {
  if (!Array.isArray(x)) return undefined;
  const o = x.slice(0, 5).map((v) => clean({ title: str(obj(v).title, 200) ?? "", year: num(obj(v).year), type: "Film" as const })).filter((v) => v.title);
  return o.length > 1 ? o : undefined;
}
/** Custom lists keep no year or director text: a match reason that quotes them is stored as a code and rebuilt from the request. */
function reasonCode(r: string): string {
  if (/^Title found, but no record from /.test(r)) return "@no_year";
  if (/^Title and year found, but no record names /.test(r)) return "@no_director";
  return r;
}
export function reasonFromCode(r: string, input: CompInput): string {
  if (r === "@no_year") return `Title found, but no record from ${input.year} give or take 1 year.`;
  if (r === "@no_director") return `Title and year found, but no record names ${input.director}.`;
  return r;
}
export function trimTagLook(x: unknown): TagLookRec {
  const t = obj(x);
  return clean({ totalTags: num(t.totalTags) ?? 0, sharedWithDeck: num(t.sharedWithDeck) ?? 0, uniqueCount: num(t.uniqueCount) ?? 0, uniqueGenre: str(t.uniqueGenre, 120), uniqueKeyword: str(t.uniqueKeyword, 120) });
}
export function trimRecordedComp(x: unknown, titleOnly = false): RecordedComp {
  const c = obj(x), a = obj(c.audience), v = obj(c.views);
  const female = num(a.female), age = num(a.age);
  return {
    input: trimInput(c.input, titleOnly),
    match: trimMatch(c.match, titleOnly),
    audience: female !== undefined && age !== undefined ? { female, age } : null,
    views: clean({ article: str(v.article, 200), views: num(v.views), error: str(v.error, 200) }),
    tagLooks: Object.fromEntries(Object.entries(obj(c.tagLooks)).slice(0, 64).map(([k, t]) => [k.slice(0, 2000), trimTagLook(t)])),
  };
}
export function trimRecording(x: unknown, opts: { titleOnly?: boolean } = {}): Recording {
  const r = obj(x);
  const fit: Recording["fit"] = {};
  for (const [k, row] of Object.entries(obj(r.fit)).slice(0, 64)) {
    fit[k.slice(0, 2000)] = Object.fromEntries(Object.entries(obj(row)).map(([t, a]) => [t.slice(0, 200), num(a)]).filter(([, a]) => a !== undefined));
  }
  return {
    schema: RECORDING_SCHEMA,
    id: str(r.id, 80) ?? "",
    label: opts.titleOnly ? "" : str(r.label, 80) ?? "",
    recordedAt: str(r.recordedAt, 40) ?? new Date().toISOString(),
    comps: (Array.isArray(r.comps) ? r.comps : []).slice(0, 12).map((c) => trimRecordedComp(c, opts.titleOnly)),
    fit,
  };
}
/** A replay keeps the result the page shows; Qloo IDs, tag lists and recorded looks are dropped. */
export function trimReplay(x: unknown): Replay {
  const r = obj(x), res = obj(r.result);
  const comps = (Array.isArray(res.comps) ? res.comps : []).slice(0, 12).map((c0) => {
    const c = obj(c0);
    const { entityId: _e, recordTags: _t, recordedTagLooks: _l, ...match } = obj(c.match);
    const fit = c.fit ? { ...obj(c.fit), entityId: "" } : undefined;
    return { ...c, match: { ...match, input: trimInput(match.input) }, fit };
  });
  return clean({ schema: REPLAY_SCHEMA, id: str(r.id, 80) ?? "", recordedAt: str(r.recordedAt, 40) ?? "", model: str(r.model, 80), synthetic: r.synthetic === true ? true : undefined, without: Array.isArray(r.without) && r.without.length ? r.without.slice(0, 12).map((t) => str(t, 200) ?? "").filter(Boolean) : undefined, result: { ...res, comps } as unknown as CheckResult });
}
export function trimLanding(x: unknown): LandingSnippet {
  const l = obj(x);
  return { deck: str(l.deck, 80) ?? "", comps: num(l.comps) ?? 0, recordedAt: str(l.recordedAt, 40), verdictLines: (Array.isArray(l.verdictLines) ? l.verdictLines : []).slice(0, 4).map((s) => str(s, 300) ?? "") };
}
export const entryBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
