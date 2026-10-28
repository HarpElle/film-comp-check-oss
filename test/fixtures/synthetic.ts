import { deckKey } from "@/lib/tools";
import { RECORDING_SCHEMA, type Recording, type TagLookRec } from "@/lib/trim";
import type { CompInput } from "@/lib/types";

/**
 * Synthetic recordings for tests and CI (no Qloo data): every number is made up from the comp's position.
 * Fit is recorded for the full deck and for each one-comp Remove; tag looks only for the full deck, so a
 * Remove leaves tag-look gaps ("Not recorded: <comp> tags").
 */
export function syntheticRecording(id: string, label: string, inputs: CompInput[], recordedAt = "2026-10-09T17:00:00.000Z"): Recording {
  const titles = inputs.map((c) => c.title);
  const fitFor = (members: number[]) => Object.fromEntries(members.map((i) => [titles[i], +(0.61 + 0.037 * ((i * 5) % inputs.length) + 0.0011 * members.length).toFixed(6)]));
  const all = inputs.map((_, i) => i);
  const fit: Recording["fit"] = { [deckKey(titles)]: fitFor(all) };
  if (inputs.length > 3) for (const x of all) { const mk = all.filter((i) => i !== x); fit[deckKey(mk.map((i) => titles[i]))] = fitFor(mk); }
  const look = (i: number): Record<string, TagLookRec> => ({ [deckKey(titles.filter((_, j) => j !== i))]: { totalTags: 20 + i, sharedWithDeck: 15 + i, uniqueCount: 5, uniqueGenre: i === 1 ? "Synthetic Genre" : undefined, uniqueKeyword: "synthetic keyword" } });
  return {
    schema: RECORDING_SCHEMA, id, label, recordedAt,
    fit,
    comps: inputs.map((input, i) => ({
      input,
      match: { badge: "Matched", matchedTitle: input.title, matchedYear: input.year, directorInRecord: input.director, yearRule: input.year ? "exact" : undefined, reason: "" },
      // Comp 1 sits far from the rest on age (one outlier); the others are close together.
      audience: { female: +(-0.61 + 0.243 * i).toFixed(6), age: i === 1 ? 0.91 : +((i % 2 ? 0.37 : -0.41) + 0.029 * i).toFixed(6) },
      views: { article: `${input.title} (film)`, views: 10_000 * (i + 2) + 123 },
      tagLooks: look(i),
    })),
  };
}
