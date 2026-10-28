/**
 * Builds the recorded sample decks from the local Qloo cache, never from live calls (the Qloo key is
 * removed from this process, so a cache miss fails before any request). Returns trimmed recordings only:
 * the match fields the UI shows, leave-one-out fit per recorded deck make-up, audience lean values, the tag
 * look per make-up with only the tag names a Why line can cite, and pageview counts. No response bodies,
 * no entity IDs, no tag lists. Used by scripts/seed-store.ts.
 */
import { QlooClient } from "@/lib/qloo";
import { liveDeps } from "@/lib/check";
import { pickMatch } from "@/lib/match";
import { skewScores } from "@/lib/skew";
import { scoreLeaveOneOut } from "@/lib/deckfit";
import { deckKey } from "@/lib/tools";
import { DREAM_HACKERS, HELLO_PARIS, PENNYWELL } from "@/lib/demo";
import { RECORDING_SCHEMA as SAMPLE_SCHEMA, trimRecording, type RecordedComp as SampleComp, type Recording as SampleFixture, type TagLookRec } from "@/lib/trim";
import type { CompInput, MatchResult } from "@/lib/types";

const DECKS: { id: string; label: string; comps: CompInput[] }[] = [
  { id: "pennywell", label: "Pennywell", comps: PENNYWELL },
  { id: "dreamhackers", label: "Dream Hackers", comps: DREAM_HACKERS },
  { id: "helloparis", label: "Hello & Paris", comps: HELLO_PARIS },
];

function tagLook(mine: MatchResult, others: MatchResult[]): TagLookRec {
  const tags = mine.recordTags ?? [];
  const seen = new Set(others.flatMap((o) => (o.recordTags ?? []).map((t) => t.tagId)));
  const unique = tags.filter((t) => !seen.has(t.tagId));
  return { totalTags: tags.length, sharedWithDeck: tags.length - unique.length, uniqueCount: unique.length, uniqueGenre: unique.find((t) => /genre/.test(t.type))?.name, uniqueKeyword: unique.find((t) => /keyword/.test(t.type))?.name };
}

export async function buildSampleRecordings(): Promise<{ recordings: SampleFixture[]; report: string[] }> {
  delete process.env.QLOO_API_KEY; // a cache miss throws "not set" before any request goes out
  const report: string[] = [];
  const recordings: SampleFixture[] = [];
  for (const deck of DECKS) {
    const q = new QlooClient();
    const deps = liveDeps(q, false);
    const gaps: string[] = [];
    const matches: MatchResult[] = [];
    for (const c of deck.comps) {
      try { matches.push(pickMatch(c, await q.searchMovies(c.title))); }
      catch (e) { gaps.push(`search ${c.title}: ${(e as Error).message}`); matches.push({ input: c, badge: "Unmatched", reason: "not in cache" }); }
    }
    if (gaps.length) { report.push(`${deck.label}: NOT BUILT. ${gaps.join("; ")}`); continue; }
    const matched = matches.map((m, i) => ({ m, i })).filter((x) => x.m.badge === "Matched");
    // Deck make-ups: the full deck, then each one-comp Remove (what the sample's Remove button can reach).
    const makeups = [matched, ...(matched.length > 3 ? matched.map((x) => matched.filter((y) => y !== x)) : [])];
    const fit: SampleFixture["fit"] = {};
    const tagLooks: Record<number, Record<string, TagLookRec>> = {};
    for (const mk of makeups) {
      const name = mk.length === matched.length ? "full deck" : `without ${matched.find((x) => !mk.includes(x))!.m.matchedTitle}`;
      const rows = await scoreLeaveOneOut(mk.map((x) => ({ key: String(x.i), entityId: x.m.entityId! })), deps.fit);
      const missing = rows.filter((r) => typeof r.affinity !== "number");
      if (missing.length) { report.push(`${deck.label} ${name}: fit not cached for ${missing.length} of ${rows.length} (${missing.map((r) => matches[+r.key].matchedTitle).join(", ")}); make-up not recorded`); continue; }
      fit[deckKey(mk.map((x) => x.m.matchedTitle!))] = Object.fromEntries(rows.map((r) => [matches[+r.key].matchedTitle!, r.affinity!]));
      for (const x of mk) (tagLooks[x.i] ??= {})[deckKey(mk.filter((y) => y !== x).map((y) => y.m.matchedTitle!))] = tagLook(x.m, mk.filter((y) => y !== x).map((y) => y.m));
      report.push(`${deck.label} ${name}: fit cached for all ${rows.length}; tag look computed for all ${rows.length} (from cached /search records, no extra call)`);
    }
    const comps: SampleComp[] = [];
    for (const [i, m] of matches.entries()) {
      let audience: SampleComp["audience"] = null;
      if (m.badge === "Matched") {
        try {
          const v = skewScores(await q.demographics(m.entityId!));
          if (typeof v.female === "number" && typeof v.age === "number") audience = { female: v.female, age: v.age };
          else report.push(`${deck.label} ${m.matchedTitle}: audience values incomplete in cache`);
        } catch (e) { report.push(`${deck.label} ${m.matchedTitle}: audience not cached (${(e as Error).message})`); }
      }
      let views: SampleComp["views"] = { error: "not recorded" };
      if (m.badge === "Matched") { try { views = await deps.views(m.matchedTitle!, m.matchedYear); } catch { views = { error: "pageviews lookup failed" }; } }
      const { entityId: _e, recordTags: _t, recordedTagLooks: _r, input, ...shown } = m;
      comps.push({ input, match: shown, audience, views, tagLooks: tagLooks[i] ?? {} });
    }
    if (q.stats.calls !== 0) throw new Error("a Qloo call was made while building samples");
    const fx: SampleFixture = {
      schema: SAMPLE_SCHEMA, id: deck.id, label: deck.label, recordedAt: q.stats.oldestCachedAt ?? new Date().toISOString(),
      comps, fit,
    };
    recordings.push(trimRecording(fx));
    report.push(`${deck.label}: written (${Object.keys(fit).length} make-up(s); Qloo cache entries from ${fx.recordedAt}; 0 Qloo calls)`);
  }
  return { recordings, report };
}
