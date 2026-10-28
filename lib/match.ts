import type { QlooEntity } from "./qloo";
import type { CompInput, MatchResult } from "./types";
import { directorNamedIn, normalizeTitle } from "./normalize";

export function recordYear(e: QlooEntity): number | undefined {
  const y = e.properties?.release_year;
  const n = typeof y === "string" ? parseInt(y, 10) : typeof y === "number" ? y : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function recordText(e: QlooEntity): string {
  const p = e.properties ?? {};
  return [e.name, e.disambiguation ?? "", String(p.description ?? ""), JSON.stringify(p.short_descriptions ?? ""), JSON.stringify(e.tags ?? [])].join(" ");
}

/**
 * The director credit exactly as the record writes it, from its description: the name(s) right after
 * "directed by", cut where the names end ("directed by Mara Quill and Theo Quill and starring ..."
 * gives "Mara Quill and Theo Quill"; "directed by Rowan Vale and based on ..." gives "Rowan Vale"). Names are capitalized words (initials and name particles allowed), joined only by
 * " and " or " & ". The names must be followed by a clear end: punctuation, " and <lowercase word>", or a
 * lowercase word. Anything unsure gives undefined, so the UI shows no director line rather than a guess.
 */
const WORD = String.raw`(?!(?:Starring|Written|Produced|Based|Featuring|With|And|From)\b)(?:\p{Lu}\.(?:\s?\p{Lu}\.)*|\p{Lu}[\p{Ll}\p{Lu}'’-]*)`;
const PARTICLE = String.raw`(?:de|da|del|della|der|den|di|du|la|le|van|von|bin|al|y)`;
const NAME = String.raw`${WORD}(?:\s+(?:${PARTICLE}\s+)?${WORD}){0,4}`;
const CREDIT = new RegExp(String.raw`\bdirected by (${NAME}(?:\s+(?:and|&)\s+${NAME}){0,3})(?=\s*[,;:.)\u2013\u2014]|\s+(?:and|&)\s+\p{Ll}|\s+\p{Ll}|\s*$)`, "u");
export function directorCredit(e: QlooEntity): string | undefined {
  const d = String(e.properties?.description ?? "");
  const c = CREDIT.exec(d)?.[1]?.trim();
  return c && c.length <= 80 ? c : undefined;
}

/** What the record shows for the director, and the deck's director beside it only when the record has no full credit. */
function directorFields(e: QlooEntity, deckDirector: string | undefined): { directorInRecord?: string; directorFromDeck?: string } {
  const credit = directorCredit(e);
  if (credit && (!deckDirector || directorNamedIn(credit, deckDirector))) return { directorInRecord: credit };
  if (!deckDirector) return {};
  if (!directorNamedIn(" " + recordText(e) + " ", deckDirector)) return {}; // the record doesn't name them: no line, no guess
  // No full credit: show the part of the deck's name the record text contains, and the deck's line beside it.
  const parts = deckDirector.trim().split(/\s+/);
  const named = directorNamedIn(" " + recordText(e) + " ", deckDirector) && recordText(e).toLowerCase().includes(deckDirector.trim().toLowerCase()) ? deckDirector.trim() : parts[parts.length - 1];
  return named === deckDirector.trim() ? { directorInRecord: named } : { directorInRecord: named, directorFromDeck: deckDirector.trim() };
}

/**
 * Pick the Qloo movie record for a comp from /search results.
 * Rules: exact normalized title; year equal if any record has it, else within 1 (only when the user gave a year);
 * if the user gave a director, the record must name them. First passing record in returned order wins;
 * with no year, records of other years are listed as `options` so the page can ask which one was meant.
 */
export const MAX_OPTIONS = 5;
export function pickMatch(input: CompInput, results: QlooEntity[]): MatchResult {
  const want = normalizeTitle(input.title);
  let pool = results.filter((e) => normalizeTitle(e.name ?? "") === want);
  if (!pool.length) return { input, badge: "Unmatched", reason: "No Qloo movie record with this exact title." };
  let yearRule: MatchResult["yearRule"];
  if (input.year !== undefined) {
    const exact = pool.filter((e) => recordYear(e) === input.year);
    const near = pool.filter((e) => { const y = recordYear(e); return y !== undefined && Math.abs(y - input.year!) <= 1; });
    pool = exact.length ? exact : near;
    yearRule = exact.length ? "exact" : "within1";
    if (!pool.length) return { input, badge: "Unmatched", reason: `Title found, but no record from ${input.year} give or take 1 year.` };
  }
  if (input.director && input.director.trim()) {
    pool = pool.filter((e) => directorNamedIn(recordText(e), input.director!));
    if (!pool.length) return { input, badge: "Unmatched", reason: `Title and year found, but no record names ${input.director}.` };
  }
  const e = pool[0];
  // Several matches (error copy item 4): no year to tell them apart, and the records differ in year.
  const byYear = new Map<string, { title: string; year?: number; type: "Film" }>();
  if (input.year === undefined) for (const r of pool) { const y = recordYear(r); if (!byYear.has(String(y))) byYear.set(String(y), { title: r.name ?? input.title, year: y, type: "Film" }); }
  const options = byYear.size > 1 ? [...byYear.values()].slice(0, MAX_OPTIONS) : undefined;
  const noPop = typeof e.popularity !== "number" || e.popularity === 0;
  const noTags = !e.tags || e.tags.length === 0;
  return {
    input,
    badge: "Matched",
    entityId: e.entity_id,
    matchedTitle: e.name,
    matchedYear: recordYear(e),
    ...directorFields(e, input.director?.trim() || undefined),
    yearRule: input.year !== undefined ? yearRule : undefined,
    options,
    warning: noPop && noTags ? "Thin record: no popularity and no tags. Scores may come back empty." : undefined,
    recordTags: (e.tags ?? []).filter((t) => t.tag_id && t.name).map((t) => ({ name: t.name!, tagId: t.tag_id!, type: t.type ?? "" })),
    reason: "",
  };
}
