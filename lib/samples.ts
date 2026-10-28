import "server-only";
import { deckKey, type ToolDeps } from "./tools";
import { kv } from "./kv";
import { reasonFromCode, type Recording, type Replay } from "./trim";
import type { CompInput } from "./types";

/**
 * Recorded Qloo runs, read through the store (lib/kv.ts): sample decks under sample: keys (no expiry), and
 * custom comp lists under comp: keys (30 days). Values are trimmed (lib/trim.ts): the match shown on screen,
 * fit per deck make-up, audience lean values, tag-look counts with only the tag names a Why line can cite,
 * pageview counts. No Qloo response bodies, entity IDs or tag lists. With no store or no data: no samples.
 */
export type SampleFixture = Recording;
export type ClaudeReplay = Replay;
export { RECORDING_SCHEMA as SAMPLE_SCHEMA } from "./trim";
export type { TagLookRec, RecordedComp as SampleComp } from "./trim";

const norm = (c: CompInput) => `${c.title.trim().toLowerCase()}|${c.year ?? ""}|${(c.director ?? "").trim().toLowerCase()}`;

let memo: { at: number; p: Promise<{ samples: SampleFixture[] }> } | undefined;
/** Sample decks from the store, kept in memory for a minute (one store read per minute per instance). */
export function loadSamples(): Promise<{ samples: SampleFixture[] }> {
  if (memo && Date.now() - memo.at < 60_000) return memo.p;
  const p = kv().samples().then((samples) => ({ samples }), () => ({ samples: [] as SampleFixture[] }));
  memo = { at: Date.now(), p };
  return p;
}
export function resetSamplesForTests() { memo = undefined; }

/** The recorded sample this deck is (the full sample, or a recorded make-up after Remove), if any. */
export async function sampleFor(comps: CompInput[]): Promise<SampleFixture | undefined> {
  const { samples } = await loadSamples();
  const want = comps.map(norm);
  for (const s of samples) {
    const sub = s.comps.filter((c) => want.includes(norm(c.input)));
    if (sub.length !== comps.length || new Set(want).size !== want.length) continue;
    const titles = sub.filter((c) => c.match.badge === "Matched").map((c) => c.match.matchedTitle!);
    if (s.fit[deckKey(titles)]) return { ...s, comps: comps.map((c) => s.comps.find((x) => norm(x.input) === norm(c))!) };
  }
  return undefined;
}

/** True when every comp comes from one recorded sample (e.g. a Remove the recording doesn't cover). */
export async function fromSample(comps: CompInput[]): Promise<SampleFixture | undefined> {
  const { samples } = await loadSamples();
  return samples.find((s) => comps.every((c) => s.comps.some((x) => norm(x.input) === norm(c))));
}

/** Tool data served from a recorded sample. Entity IDs are synthetic (sample:<id>:<n>); nothing calls Qloo. */
export function sampleDeps(s: SampleFixture): ToolDeps {
  const idOf = (i: number) => `sample:${s.id}:${i}`;
  const byId = new Map(s.comps.map((c, i) => [idOf(i), c]));
  const byNorm = new Map(s.comps.map((c, i) => [norm(c.input), i]));
  const no = () => Promise.reject(new Error("recorded sample: no live Qloo call"));
  return {
    search: no,
    demographics: no,
    resolve: async (input) => {
      const i = byNorm.get(norm(input))!;
      const c = s.comps[i];
      return { ...c.match, input, entityId: c.match.badge === "Matched" ? idOf(i) : undefined, recordedTagLooks: c.tagLooks };
    },
    fit: async (others, target) => {
      const t = byId.get(target)?.match.matchedTitle;
      const k = deckKey([...others.map((o) => byId.get(o)?.match.matchedTitle ?? o), t ?? target]);
      const a = t ? s.fit[k]?.[t] : undefined;
      return typeof a === "number" ? { affinity: a, http: 200 } : { error: "not in the recorded run" };
    },
    audience: async (id) => byId.get(id)?.audience ?? {},
    views: async (title) => s.comps.find((c) => c.match.matchedTitle === title || c.input.title === title)?.views ?? { error: "not recorded" },
  };
}

export async function replayFor(id: string, without?: string[]): Promise<ClaudeReplay | undefined> {
  return kv().replay(id, without);
}

/** A custom comp list recorded within the last 30 days (comp: key); inputs come back from the request. */
export async function compRecording(comps: CompInput[]): Promise<SampleFixture | undefined> {
  const r = await kv().comp(comps);
  if (!r || r.comps.length !== comps.length) return undefined;
  return {
    ...r,
    comps: r.comps.map((c, i) => {
      const d = comps[i].director?.trim();
      return { ...c, input: comps[i], match: { ...c.match, reason: reasonFromCode(c.match.reason, comps[i]), directorFromDeck: c.match.directorInRecord && d && d !== c.match.directorInRecord ? d : undefined } };
    }),
  };
}

export const NOT_RECORDED = "This make-up of the sample isn't in the recorded Qloo run, and live Qloo checks are paused, so it can't be scored right now. Put the comp back or reload the sample.";
