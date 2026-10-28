import { say, type Structured } from "./claims";
import { skewDirection } from "./skew";
import type { CompResult, CheckResult } from "./types";

/**
 * Per-comp Why lines for the results table and export. Each line is structured: free text plus
 * source-tagged claims, so every number and name goes through the guard. Fit scores are claimed at
 * 6 decimals; the screen renders and guards them at 3 (see atScreen in lib/check.ts), export at 6.
 * `id(key)` is the comp's stable source label (compLabel).
 */
export interface ReasonWriter {
  structured(comp: CompResult, deck: CheckResult, id: (key: string) => string): Structured[];
}

/** Split direction, only when age is the comp's larger deviation from the deck mean. */
export function splitAgeDirection(c: CompResult, deck: CheckResult): { word: "older" | "younger"; dAge: number } | undefined {
  const m = deck.deckMean;
  if (!m || typeof c.skew?.age !== "number" || typeof c.skew?.female !== "number") return undefined;
  const dAge = c.skew.age - m.age, dFemale = c.skew.female - m.female;
  const d = skewDirection(dFemale, dAge);
  if (d === "an older") return { word: "older", dAge };
  if (d === "a younger") return { word: "younger", dAge };
  return undefined; // gender is the larger deviation
}

export const deterministicReasons: ReasonWriter = {
  structured(c, deck, idOf) {
    const out: Structured[] = [];
    const id = idOf(c.key);
    const m = c.match;
    if (m.badge === "Unmatched") {
      out.push(say("Unmatched: ").claim(`resolve:${id}`, "reason", m.reason ?? "no match").text(" Left out of all scoring.").done());
      return out;
    }
    const r = say("Matched to ").quoted(`resolve:${id}`, "matchedTitle", m.matchedTitle ?? "").text(" (");
    if (m.matchedYear !== undefined) r.claim(`resolve:${id}`, "matchedYear", m.matchedYear, "int"); else r.text("year not in record");
    r.text(")");
    if (m.yearRule === "within1") r.text(" (year off by one)");
    if (m.directorInRecord) r.text(", record names ").claim(`resolve:${id}`, "directorInRecord", m.directorInRecord);
    if (m.directorInRecord && m.directorFromDeck) r.text("; deck lists ").claim(`resolve:${id}`, "directorFromDeck", m.directorFromDeck);
    out.push(r.text(".").done());
    if (m.warning) out.push(say("Warning: ").claim(`resolve:${id}`, "warning", m.warning).done());
    if (c.agentStatus === "set_aside" && c.fit?.status !== "Unscored") out.push(say("Set aside by the agent: ").claim(`state:${id}`, "setAsideWhy", c.setAsideWhy ?? "not scorable").text(". Not used as input for the other comps.").done());
    const f = c.fit;
    if (f?.status === "Unscored") out.push(say("Unscored: Qloo returned no fit score (").claim(`deckfit:${id}`, "error", f.error ?? "empty").text("). Left out of the other comps' inputs and the deck was rescored.").done());
    if (f?.status === "Not run" && c.agentStatus !== "set_aside") out.push(say("Not scored: ").claim(`deckfit:${id}`, "error", f.error ?? "not run").done());
    if (f?.status === "Scored" && typeof f.affinity === "number") {
      const rk = say();
      if (c.rank) {
        rk.text(" Rank ").claim(`rank:${id}`, "rank", c.rank.rank, "int").text(" of ").claim(`rank:${id}`, "of", c.rank.of, "int");
        if (c.rank.gapToNext !== undefined) rk.text(", ").claim(`rank:${id}`, "gapToNext", c.rank.gapToNext, "f3").text(" below the next comp."); else rk.text(", top fit.");
      }
      const rkd = rk.done();
      if (c.considerCutting && c.cutLabel) {
        const s = say().claim("rank_deck", "label", c.cutLabel).text(": lowest fit with the other comps (").claim(`deckfit:${id}`, "affinity", f.affinity, "f6").text(").").join(rkd, "");
        if (deck.cutSpread !== undefined && deck.cutGap !== undefined) s.text(" Gap ").claim("rank_deck", "gap", deck.cutGap, "f3").text(" vs spread of the rest ").claim("rank_deck", "spread", deck.cutSpread, "f3").text(".");
        out.push(s.done());
      } else out.push(say("Fit with the other comps: ").claim(`deckfit:${id}`, "affinity", f.affinity, "f6").text(".").join(rkd, "").done());
    }
    if (c.skewFlag) out.push(say("Audience outlier: brings ").claim("skew:deck", "direction", c.skewFlag.direction).text(" audience than the rest of your comps (Qloo's estimate). Check it.").done());
    if (c.tagNote) out.push(say().claim(`tags:${id}`, "note", c.tagNote).done());
    if (c.skewSplit) {
      const dir = splitAgeDirection(c, deck);
      out.push(dir
        ? say("Audience split: skews ").claim(`skew:${id}`, "ageDirection", dir.word).text(" than the rest of the deck (age gap ").claim(`skew:${id}`, "dAge", dir.dAge, "abs3").text(", Qloo's estimate), one of several comps that skew differently.").done()
        : say("Audience split: this comp is one of several that skew differently from the deck (Qloo's estimate).").done());
    }
    if (c.considerCutting && c.leastViewed) out.push(say("This is also the least-viewed comp on Wikipedia, so low fit and low popularity line up here.").done());
    if (c.skew?.error && f?.status === "Scored") out.push(say("Audience estimate unavailable: ").claim(`skew:${id}`, "error", c.skew.error).text(". Left out of the deck average and the audience label; not plotted.").done());
    return out;
  },
};
