import { COPY } from "./copy";
import { formatCompLines } from "./parse";
import { readShare } from "./share";
import type { CompInput } from "./types";

/**
 * Per-URL share title and description (UX audit WP-16, 13.1), from the URL alone plus the recorded sample index (no
 * run, no Qloo call). Undefined for the landing or a link whose deck can't be read: the defaults stay.
 */
export interface ShareMeta { title: string; description: string }
type Sample = { id: string; label: string; comps: CompInput[] };
const name = (label: string) => label.replace(/\s*deck$/i, "");

export function shareMeta(params: Record<string, string | string[] | undefined>, samples: Sample[]): ShareMeta | undefined {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, x);
  const recorded = (s: Sample, without?: string): ShareMeta => without
    ? { title: `${name(s.label)} sample without ${without} · ${COPY.title}`, description: `${s.comps.length - 1} comps checked with Qloo taste data. Recorded sample run.` }
    : { title: `${name(s.label)} sample: comp check · ${COPY.title}`, description: `${s.comps.length} comps checked with Qloo taste data. Recorded sample run.` };
  const byId = q.get("sample") && samples.find((s) => s.id === q.get("sample"));
  if (byId) {
    const w = q.get("without");
    return recorded(byId, w && byId.comps.some((c) => c.title.toLowerCase() === w.toLowerCase()) ? w : undefined);
  }
  const sh = readShare(`?${q.toString()}`);
  if (!sh || sh.error) return undefined;
  const same = samples.find((s) => formatCompLines(s.comps) === formatCompLines(sh.comps));
  if (same) return recorded(same);
  const n = sh.comps.length, first = sh.comps.slice(0, 3).map((c) => c.title), k = n - first.length;
  return { title: `${n} comps to check · ${COPY.title}`, description: `${first.join(", ")}${k > 0 ? ` and ${k} more` : ""}. Open to check this comp slide.` };
}
