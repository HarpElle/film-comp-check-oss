import type { CompInput } from "./types";

/**
 * One comp per line: "Title | Year | Director", "Title (Year)", "Title (Year) | Director", or the same fields
 * tab-separated (pasted from a spreadsheet). Year and director are optional; a trailing "(YYYY)" becomes the year.
 */
/** A pasted list marker ("• ", "- ", "1. ", "2) "), stripped before a line is read (UX audit WP-12, 10.1). */
const BULLET = /^\s*(?:[\u2022\u00b7\u25aa\u25e6*\-\u2013\u2014]|\d{1,2}[.)])\s+/;

export function parseCompLines(text: string): CompInput[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET, "").trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\||\t/).map((s) => s.trim());
      let [title, year, director]: (string | undefined)[] = parts;
      const m = /^(.+?)\s*\((\d{4})\)$/.exec(title);
      if (m) {
        title = m[1].trim();
        const rest = parts.slice(1);
        if (rest[0] && /^\d{4}$/.test(rest[0])) { year = rest[0]; director = rest[1]; } else { year = m[2]; director = rest.find(Boolean); }
      }
      const y = year ? parseInt(year, 10) : NaN;
      return { title, year: Number.isFinite(y) ? y : undefined, director: director || undefined };
    })
    .filter((c) => c.title);
}

export function formatCompLines(comps: CompInput[]): string {
  return comps.map((c) => [c.title, c.year ?? "", c.director ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
}

export function validateComps(comps: CompInput[]): string | undefined {
  if (comps.length < 3 || comps.length > 10) return "Enter between 3 and 10 comps.";
  if (comps.some((c) => c.title.length > 200)) return "A title is too long.";
  return undefined;
}
