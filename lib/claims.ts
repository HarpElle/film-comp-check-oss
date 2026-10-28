/**
 * Source-tagged claims. Every reason and the verdict are a template with placeholders {0}, {1}, ...
 * plus a list of claims. Each claim names the tool result it comes from (sourceId), the field in that
 * result, the value, and how it is shown. The renderer fills placeholders only from claims, and the
 * guard checks every claim against the stored tool results.
 */
export type Fmt = "text" | "int" | "f3" | "f6" | "abs3" | "thousands" | "num";

export interface Claim { sourceId: string; field: string; value: string | number; fmt: Fmt }
export interface Structured { template: string; claims: Claim[] }

/** Tool results by stable ID, e.g. deckfit:Alpha, skew:Bravo, pageviews:Alpha, resolve:Alpha, rank_deck, count:matched. */
export type Sources = Map<string, Record<string, unknown>>;

export function formatValue(v: unknown, fmt: Fmt): string {
  if (fmt === "text") return String(v);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (fmt) {
    case "int": return String(Math.round(n));
    case "f3": return n.toFixed(3);
    case "f6": return n.toFixed(6);
    case "abs3": return Math.abs(n).toFixed(3);
    case "thousands": return Math.round(n).toLocaleString("en-US");
    case "num": return String(n);
  }
}

/** Builds a Structured text: plain pieces and claims, with placeholders numbered in order. */
export class Say {
  private t = "";
  private c: Claim[] = [];
  text(s: string): this { this.t += s; return this; }
  claim(sourceId: string, field: string, value: string | number, fmt: Fmt = "text"): this {
    this.t += `{${this.c.length}}`;
    this.c.push({ sourceId, field, value, fmt });
    return this;
  }
  /** A claimed title wrapped in quotes, the way reasons show film names. */
  quoted(sourceId: string, field: string, value: string): this { return this.text('"').claim(sourceId, field, value).text('"'); }
  join(other: Structured, sep = " "): this {
    const base = this.c.length;
    this.t += (this.t ? sep : "") + other.template.replace(/\{(\d+)\}/g, (_, i) => `{${Number(i) + base}}`);
    this.c.push(...other.claims);
    return this;
  }
  done(): Structured { return { template: this.t, claims: this.c }; }
}
export const say = (s = "") => new Say().text(s);

export function render(st: Structured): string {
  return st.template.replace(/\{(\d+)\}/g, (_, i) => {
    const c = st.claims[Number(i)];
    return c ? formatValue(c.value, c.fmt) : "";
  });
}

/** Returns why a structured text is rejected, or undefined if every claim checks out. */
export function guardStructured(st: Structured, sources: Sources): string | undefined {
  if (!st || typeof st.template !== "string" || !Array.isArray(st.claims)) return "reason is not structured";
  if (!st.template.trim()) return "empty reason";
  if (/[\r\n]/.test(st.template)) return "reason must be one line";
  const used = [...st.template.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
  for (const i of used) if (i >= st.claims.length) return `placeholder {${i}} has no claim`;
  if (st.claims.some((_, i) => !st.template.includes(`{${i}}`))) return "a claim is not used in the text";
  const free = st.template.replace(/"\{\d+\}"/g, " ").replace(/\{\d+\}/g, " ");
  if (/\d/.test(free)) return `free text has a digit: "${free.match(/\S*\d\S*/)![0]}"`;
  if (free.includes('"')) return "quoted names must be claims";
  for (const c of st.claims) {
    const src = sources.get(c.sourceId);
    if (!src) return `unknown source ${c.sourceId}`;
    if (!(c.field in src) || src[c.field] === undefined || src[c.field] === null) return `${c.sourceId} has no field ${c.field}`;
    const want = formatValue(src[c.field], c.fmt), got = formatValue(c.value, c.fmt);
    if (want !== got) return `${c.sourceId}.${c.field} is ${want}, not ${got}`;
  }
  if (render(st).length > 280) return "reason must be one line";
  return undefined;
}
