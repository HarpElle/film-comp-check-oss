import "server-only";
import { cacheGetEntry, cachePut } from "./cache";

export const QLOO_BASE = "https://hackathon.api.qloo.com";
/** Test-only: a mocked Qloo (Playwright) via QLOO_BASE_URL, honored off Vercel only; QLOO_MIN_GAP_MS only with it. */
const mockBase = () => (!process.env.VERCEL && process.env.QLOO_BASE_URL) || undefined;
export const qlooBase = () => mockBase() ?? QLOO_BASE;

export class QlooError extends Error {
  constructor(message: string, public readonly kind: "config" | "http" | "timeout" | "network" | "rate_limited" | "parse" | "quota", public readonly status?: number) {
    super(message);
    this.name = "QlooError";
  }
}

export interface QlooEntity {
  name: string;
  entity_id: string;
  types?: string[];
  properties?: Record<string, unknown> & { release_year?: string | number; description?: string };
  popularity?: number;
  disambiguation?: string;
  tags?: { name?: string; tag_id?: string; type?: string }[];
  query?: { affinity?: number } & Record<string, unknown>;
}

export interface QlooOptions {
  bypassCache?: boolean;
  minGapMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Absolute time (ms since epoch) after which no request starts and no backoff sleeps past. */
  deadline?: number;
  /** Called once, just before the first request that actually goes to Qloo (not a cache hit). */
  onLive?: () => void;
  /** Called with x-month-ratelimit-remaining from every Qloo response that carries it (daily pacing). */
  onQuota?: (remaining: number) => void;
}

/** The raw response file cache is for local dev only: on Vercel nothing raw is written (the store keeps trimmed fields). */
const rawCacheOn = () => !process.env.VERCEL;

export interface QlooStats { calls: number; cacheHits: number; oldestCachedAt?: string }

/** Sequential client: one request at a time, ~0.5 s apart, 429 exponential backoff, timeout, typed errors. */
export class QlooClient {
  private nextSlot = 0; // start-time reservations keep requests minGapMs apart, also when several run at once
  private chain: Promise<unknown> = Promise.resolve();
  readonly stats: QlooStats = { calls: 0, cacheHits: 0 };
  private wentLive = false;
  constructor(private readonly opts: QlooOptions = {}) {}

  private key(): string {
    const k = process.env.QLOO_API_KEY;
    if (!k) throw new QlooError("QLOO_API_KEY is not set on the server", "config");
    return k;
  }

  /** Returns parsed JSON body for a 200. Throws QlooError otherwise. */
  get<T = unknown>(path: string, params: Record<string, string | number>, call: CallOptions = {}): Promise<T> {
    const run = () => this.getNow<T>(path, params, call);
    if (call.parallel) return run(); // still spaced by the start-slot reservation and bounded by the caller's pool
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async getNow<T>(path: string, params: Record<string, string | number>, call: CallOptions = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const url = `${qlooBase()}${path}?${qs}`;
    if (!this.opts.bypassCache && rawCacheOn()) {
      const hit = await cacheGetEntry<T>(url);
      if (hit !== undefined) {
        this.stats.cacheHits++;
        if (hit.savedAt && (!this.stats.oldestCachedAt || hit.savedAt < this.stats.oldestCachedAt)) this.stats.oldestCachedAt = hit.savedAt;
        return hit.body;
      }
    }
    const key = this.key();
    if (!this.wentLive) { this.wentLive = true; try { this.opts.onLive?.(); } catch { /* never break a run */ } }
    const gap = this.opts.minGapMs ?? (mockBase() && process.env.QLOO_MIN_GAP_MS ? Number(process.env.QLOO_MIN_GAP_MS) : 500);
    const maxRetries = call.maxRetries ?? this.opts.maxRetries ?? 2;
    const deadline = Math.min(this.opts.deadline ?? Infinity, call.deadline ?? Infinity);
    const left = () => deadline - Date.now();
    for (let attempt = 0; ; attempt++) {
      if (call.signal?.aborted) throw new QlooError(`cancelled on ${path}`, "timeout");
      const start = Math.max(Date.now(), this.nextSlot);
      this.nextSlot = start + gap;
      if (start - Date.now() > 0) await sleep(start - Date.now());
      if (left() <= 0) throw new QlooError(`out of time on ${path}`, "timeout");
      this.stats.calls++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(call.timeoutMs ?? this.opts.timeoutMs ?? 10000, Math.max(1, left())));
      const onAbort = () => ctrl.abort();
      call.signal?.addEventListener("abort", onAbort, { once: true });
      let res: Response;
      try {
        res = await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: ctrl.signal, cache: "no-store" });
      } catch (e) {
        clearTimeout(timer); call.signal?.removeEventListener("abort", onAbort);
        if ((e as Error).name === "AbortError") throw new QlooError(`timeout on ${path}`, "timeout");
        throw new QlooError(`network error on ${path}`, "network");
      }
      clearTimeout(timer); call.signal?.removeEventListener("abort", onAbort);
      const rem = Number(res.headers.get("x-month-ratelimit-remaining") ?? NaN);
      if (Number.isFinite(rem)) { try { this.opts.onQuota?.(rem); } catch { /* never break a run */ } }
      if (res.status === 429) {
        // A used-up monthly quota will not clear by waiting: fail now instead of backing off.
        if (res.headers.get("x-month-ratelimit-remaining") === "0") throw new QlooError("Qloo's monthly request limit is used up", "quota", 429);
        if (attempt >= maxRetries) throw new QlooError(`rate limited on ${path}`, "rate_limited", 429);
        const ra = Number(res.headers.get("retry-after") ?? res.headers.get("x-second-ratelimit-reset"));
        const wait = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt, 4000); // capped, bounded retries
        if (wait >= left()) throw new QlooError(`rate limited on ${path}`, "rate_limited", 429);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new QlooError(`HTTP ${res.status} on ${path}`, "http", res.status);
      let body: T;
      try { body = (await res.json()) as T; } catch { throw new QlooError(`bad JSON on ${path}`, "parse", res.status); }
      if (rawCacheOn()) await cachePut(url, body);
      return body;
    }
  }

  async searchMovies(title: string): Promise<QlooEntity[]> {
    const d = await this.get<{ results?: QlooEntity[] }>("/search", { query: title, types: "urn:entity:movie", take: 20 });
    return d.results ?? [];
  }

  /** Leave-one-out deck fit: affinity of `target` given the other comps as signal. Undefined if absent. */
  async deckFitAffinity(others: string[], target: string): Promise<number | undefined> {
    const d = await this.get<{ results?: { entities?: QlooEntity[] } }>("/v2/insights", {
      "filter.type": "urn:entity:movie",
      "signal.interests.entities": others.join(","),
      "filter.results.entities": target,
    });
    const ents = d.results?.entities ?? [];
    const e = ents.find((x) => x.entity_id === target);
    const a = e?.query?.affinity;
    return typeof a === "number" ? a : undefined;
  }

  async demographics(entityId: string, call: CallOptions = {}): Promise<DemoQuery | undefined> {
    const d = await this.get<{ results?: { demographics?: { query?: DemoQuery }[] } }>("/v2/insights", {
      "filter.type": "urn:demographics",
      "signal.interests.entities": entityId,
    }, call);
    return d.results?.demographics?.[0]?.query;
  }
}

/** Per-call limits: run outside the sequential queue, a shorter timeout, fewer retries, an abort signal, a deadline. */
export interface CallOptions { parallel?: boolean; timeoutMs?: number; maxRetries?: number; signal?: AbortSignal; deadline?: number }

export interface DemoQuery {
  age?: Record<string, number | undefined>;
  gender?: { female?: number; male?: number };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
