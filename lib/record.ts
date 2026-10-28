import { skewScores } from "./skew";
import { deckKey, type ToolDeps } from "./tools";
import { RECORDING_SCHEMA, trimRecording, type Recording, type TagLookRec } from "./trim";
import type { MatchResult } from "./types";
import type { AgentRun } from "./agent";

/**
 * Records a live run as it happens, so the same comp list can be served again from the store (comp: key,
 * 30 days) without calling Qloo. Captures only what the tools return; the result goes through trimRecording.
 */
export function recordingDeps(deps: ToolDeps) {
  const fit: { others: string[]; target: string; affinity: number }[] = [];
  const audience = new Map<string, { female: number; age: number }>();
  const views = new Map<string, { article?: string; views?: number; error?: string }>();
  const wrapped: ToolDeps = {
    ...deps,
    fit: async (others, target) => {
      const r = await deps.fit(others, target);
      if (typeof r.affinity === "number") fit.push({ others: [...others], target, affinity: r.affinity });
      return r;
    },
    demographics: async (id, o) => {
      const r = await deps.demographics(id, o);
      const v = skewScores(r);
      if (typeof v.female === "number" && typeof v.age === "number") audience.set(id, { female: v.female, age: v.age });
      return r;
    },
    audience: deps.audience && (async (id) => {
      const v = await deps.audience!(id);
      if (typeof v.female === "number" && typeof v.age === "number") audience.set(id, { female: v.female, age: v.age });
      return v;
    }),
    views: async (title, year) => { const r = await deps.views(title, year); views.set(title, r); return r; },
  };
  function build(run: AgentRun, recordedAt: string): Recording | undefined {
    const comps = run.state.comps;
    const byId = new Map(comps.filter((c) => c.match?.entityId).map((c) => [c.match!.entityId!, c.match!]));
    const title = (id: string) => byId.get(id)?.matchedTitle;
    const fitMap: Recording["fit"] = {};
    const makeups = new Map<string, MatchResult[]>();
    for (const f of fit) {
      const t = title(f.target), os = f.others.map(title);
      if (!t || os.some((o) => !o)) continue;
      const k = deckKey([...(os as string[]), t]);
      (fitMap[k] ??= {})[t] = f.affinity;
      makeups.set(k, [...f.others, f.target].map((id) => byId.get(id)!));
    }
    if (!Object.keys(fitMap).length) return undefined;
    const tagLook = (mine: MatchResult, others: MatchResult[]): TagLookRec => {
      const tags = mine.recordTags ?? [];
      const seen = new Set(others.flatMap((o) => (o.recordTags ?? []).map((x) => x.tagId)));
      const unique = tags.filter((x) => !seen.has(x.tagId));
      return { totalTags: tags.length, sharedWithDeck: tags.length - unique.length, uniqueCount: unique.length, uniqueGenre: unique.find((x) => /genre/.test(x.type))?.name, uniqueKeyword: unique.find((x) => /keyword/.test(x.type))?.name };
    };
    return trimRecording({
      schema: RECORDING_SCHEMA, id: "custom", label: "", recordedAt,
      fit: fitMap,
      comps: comps.map((c) => {
        const m = c.match!;
        const looks: Record<string, TagLookRec> = {};
        for (const mk of makeups.values()) if (mk.includes(m)) { const others = mk.filter((x) => x !== m); looks[deckKey(others.map((o) => o.matchedTitle!))] = tagLook(m, others); }
        return { input: c.input, match: m, audience: m.entityId ? audience.get(m.entityId) ?? null : null, views: views.get(m.matchedTitle ?? c.input.title) ?? { error: "not recorded" }, tagLooks: looks };
      }),
    }, { titleOnly: true });
  }
  return { deps: wrapped, build };
}
