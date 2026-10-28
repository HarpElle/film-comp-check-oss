import { formatCompLines, parseCompLines, validateComps } from "./parse";
import type { CompInput } from "./types";

/**
 * Share links carry the deck itself in the URL (one `c` parameter per comp line), so nothing is stored for them
 * on any server and they never expire. Opening one fills the deck; only a recorded sample runs by itself.
 */
export const SHARE_PARAM = "c";
const MAX_LINE = 300;

export function shareSearch(comps: CompInput[]): string {
  const q = new URLSearchParams();
  for (const line of formatCompLines(comps).split("\n")) q.append(SHARE_PARAM, line);
  return `?${q.toString()}`;
}

export function shareUrl(origin: string, comps: CompInput[]): string {
  return `${origin.replace(/\/$/, "")}/${shareSearch(comps)}`;
}

/** The deck in a share link, or null when there is none. `error` is the deck's own validation message, or "empty" when `c` is there but blank (a broken link). */
export function readShare(search: string): { comps: CompInput[]; error?: string } | null {
  const raw = new URLSearchParams(search).getAll(SHARE_PARAM);
  if (!raw.length) return null;
  const lines = raw.map((l) => l.slice(0, MAX_LINE)).filter((l) => l.trim());
  if (!lines.length) return { comps: [], error: "empty" }; // a `c` parameter with nothing in it: a broken link
  const comps = parseCompLines(lines.join("\n"));
  return { comps, error: validateComps(comps) };
}
