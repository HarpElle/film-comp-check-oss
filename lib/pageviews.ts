import "server-only";
import { cacheGet, cachePut } from "./cache";

/** English Wikipedia user pageviews, monthly, last 12 full months. Descriptive User-Agent per Wikimedia policy. */
export const WIKI_UA = "QlooCompChecker/0.1 (private hackathon prototype; contact via repo once public) Node fetch";

export function last12FullMonths(now = new Date()): { start: string; end: string } {
  const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of previous month
  const startMonth = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 11, 1));
  const f = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}00`;
  return { start: f(startMonth), end: f(endMonth) };
}

export interface WikiStats { calls: number; cacheHits: number }

async function getJson(url: string, stats: WikiStats, bypass: boolean): Promise<{ status: number; body: unknown }> {
  if (!bypass) {
    const hit = await cacheGet<{ status: number; body: unknown }>(url);
    if (hit) { stats.cacheHits++; return hit; }
  }
  let out: { status: number; body: unknown } = { status: -1, body: null };
  for (let i = 0; i < 4; i++) {
    stats.calls++;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(url, { headers: { "User-Agent": WIKI_UA, "Api-User-Agent": WIKI_UA }, signal: ctrl.signal, cache: "no-store" });
      out = { status: r.status, body: r.ok ? await r.json() : null };
      clearTimeout(t);
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 3000 * (i + 1))); continue; }
      break;
    } catch {
      clearTimeout(t);
      out = { status: -1, body: null };
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  if (out.status === 200 || out.status === 404) await cachePut(url, out);
  return out;
}

interface WikiPage { title: string; missing?: string; pageprops?: Record<string, string>; description?: string }

/** Find the film's own article: "<T> (<year> film)", then "<T> (film)", then "<T>"; skip missing and disambiguation pages. */
export async function resolveArticle(title: string, year: number | undefined, stats: WikiStats, bypass = false): Promise<string | undefined> {
  const cands = [year ? `${title} (${year} film)` : undefined, `${title} (film)`, title].filter(Boolean) as string[];
  const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ action: "query", format: "json", formatversion: "2", redirects: "1", prop: "pageprops|description", titles: cands.join("|") }).toString();
  const d = await getJson(url, stats, bypass);
  const q = (d.body as { query?: { pages?: WikiPage[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } })?.query;
  if (!q?.pages) return undefined;
  const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((q.redirects ?? []).map((n) => [n.from, n.to]));
  for (const c of cands) {
    let t = norm.get(c) ?? c;
    t = redir.get(t) ?? t;
    const p = q.pages.find((x) => x.title === t);
    if (!p || p.missing !== undefined) continue;
    if (p.pageprops && "disambiguation" in p.pageprops) continue;
    if (!/film|movie/i.test(p.description ?? "")) continue;
    return p.title;
  }
  return undefined;
}

export async function monthlyViews(article: string, stats: WikiStats, bypass = false, now = new Date()): Promise<number | undefined> {
  const { start, end } = last12FullMonths(now);
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article.replace(/ /g, "_"))}/monthly/${start}/${end}`;
  const d = await getJson(url, stats, bypass);
  if (d.status !== 200) return undefined;
  const items = (d.body as { items?: { views: number }[] })?.items ?? [];
  return items.reduce((s, x) => s + x.views, 0);
}

/** Key of the least-viewed comp among those with a count. Ties go to input order. */
export function leastViewed(rows: { key: string; views?: number }[]): string | undefined {
  let best: { key: string; views: number } | undefined;
  for (const r of rows) if (typeof r.views === "number" && (!best || r.views < best.views)) best = { key: r.key, views: r.views };
  return best?.key;
}
