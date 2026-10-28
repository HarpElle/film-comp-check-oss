import "server-only";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Small key-value store behind one interface: in-memory (default), local file (dev, STORE_FILE_DIR, a
 * gitignored path), or Upstash Redis over REST (only when a full env pair is set: UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN, or Vercel's KV_REST_API_URL and KV_REST_API_TOKEN; UPSTASH_* wins when both are).
 * KV_REST_API_READ_ONLY_TOKEN is never used: the app writes.
 * Values are JSON. Nothing here knows about Qloo; lib/kv.ts decides keys, TTLs and trimming.
 */
export interface Store {
  readonly kind: "memory" | "file" | "upstash";
  get<T>(key: string): Promise<T | undefined>;
  mget<T>(keys: string[]): Promise<(T | undefined)[]>;
  /** ttlSec omitted: no expiry. */
  set(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<void>;
  /** Atomic +by; the expiry is set when the key is created and not extended after. */
  incr(key: string, opts: { ttlSec?: number; by?: number }): Promise<number>;
  /** Seconds left on a key: -1 no expiry, -2 missing (Redis TTL semantics). For tests and checks. */
  ttl(key: string): Promise<number>;
}

type Entry = { v: unknown; exp?: number };

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private m = new Map<string, Entry>();
  constructor(private now: () => number = Date.now) {}
  private live(key: string): Entry | undefined {
    const e = this.m.get(key);
    if (e && e.exp !== undefined && e.exp <= this.now()) { this.m.delete(key); return undefined; }
    return e;
  }
  async get<T>(key: string) { return this.live(key)?.v as T | undefined; }
  async mget<T>(keys: string[]) { return keys.map((k) => this.live(k)?.v as T | undefined); }
  async set(key: string, value: unknown, opts?: { ttlSec?: number }) {
    this.m.set(key, { v: JSON.parse(JSON.stringify(value)), exp: opts?.ttlSec ? this.now() + opts.ttlSec * 1000 : undefined });
  }
  async incr(key: string, opts: { ttlSec?: number; by?: number }) {
    const e = this.live(key);
    const n = (typeof e?.v === "number" ? e.v : 0) + (opts.by ?? 1);
    this.m.set(key, { v: n, exp: e ? e.exp : opts.ttlSec ? this.now() + opts.ttlSec * 1000 : undefined });
    return n;
  }
  async ttl(key: string) { const e = this.live(key); return !e ? -2 : e.exp === undefined ? -1 : Math.ceil((e.exp - this.now()) / 1000); }
  /** Entries with seconds left (for seeding a test server's in-memory store; see MEMORY_STORE_SEED). */
  dump(): { k: string; v: unknown; ttlSec?: number }[] {
    return [...this.m.keys()].flatMap((k) => { const e = this.live(k); return e ? [{ k, v: e.v, ttlSec: e.exp === undefined ? undefined : Math.ceil((e.exp - this.now()) / 1000) }] : []; });
  }
  load(entries: { k: string; v: unknown; ttlSec?: number }[]) { for (const e of entries) this.m.set(e.k, { v: e.v, exp: e.ttlSec ? this.now() + e.ttlSec * 1000 : undefined }); return this; }
}

/** One JSON file per key under dir (sha256 of the key). Dev only; not safe for concurrent writers. */
export class FileStore implements Store {
  readonly kind = "file" as const;
  constructor(private dir: string, private now: () => number = Date.now) {}
  private file(key: string) { return path.join(this.dir, createHash("sha256").update(key).digest("hex") + ".json"); }
  private async read(key: string): Promise<Entry | undefined> {
    try {
      const e = JSON.parse(await fs.readFile(this.file(key), "utf8")) as Entry & { k: string };
      if (e.exp !== undefined && e.exp <= this.now()) return undefined;
      return e;
    } catch { return undefined; }
  }
  private async write(key: string, e: Entry) {
    await fs.mkdir(this.dir, { recursive: true });
    const f = this.file(key), tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ k: key, ...e }));
    await fs.rename(tmp, f);
  }
  async get<T>(key: string) { return (await this.read(key))?.v as T | undefined; }
  async mget<T>(keys: string[]) { return Promise.all(keys.map((k) => this.get<T>(k))); }
  async set(key: string, value: unknown, opts?: { ttlSec?: number }) { await this.write(key, { v: value, exp: opts?.ttlSec ? this.now() + opts.ttlSec * 1000 : undefined }); }
  async incr(key: string, opts: { ttlSec?: number; by?: number }) {
    const e = await this.read(key);
    const n = (typeof e?.v === "number" ? e.v : 0) + (opts.by ?? 1);
    await this.write(key, { v: n, exp: e ? e.exp : opts.ttlSec ? this.now() + opts.ttlSec * 1000 : undefined });
    return n;
  }
  async ttl(key: string) { const e = await this.read(key); return !e ? -2 : e.exp === undefined ? -1 : Math.ceil((e.exp - this.now()) / 1000); }
}

/** Upstash Redis over REST (@upstash/redis). incr + EXPIRE NX in one pipeline, so the expiry is set once. */
export class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  private r: import("@upstash/redis").Redis;
  constructor(url: string, token: string, readonly source: "UPSTASH_REDIS_REST" | "KV_REST_API" = "UPSTASH_REDIS_REST") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    this.r = new Redis({ url, token, automaticDeserialization: true, enableTelemetry: false, enableAutoPipelining: false });
  }
  async get<T>(key: string) { return ((await this.r.get<T>(key)) ?? undefined) as T | undefined; }
  async mget<T>(keys: string[]) { return keys.length ? ((await this.r.mget<T[]>(...keys)) as (T | null)[]).map((v) => v ?? undefined) : []; }
  async set(key: string, value: unknown, opts?: { ttlSec?: number }) {
    if (opts?.ttlSec) await this.r.set(key, value, { ex: opts.ttlSec }); else await this.r.set(key, value);
  }
  async incr(key: string, opts: { ttlSec?: number; by?: number }) {
    const p = this.r.pipeline();
    p.incrby(key, opts.by ?? 1);
    if (opts.ttlSec) p.expire(key, opts.ttlSec, "NX"); // no ttlSec: the key never expires
    const [n] = (await p.exec()) as [number, number];
    return n;
  }
  async ttl(key: string) { return this.r.ttl(key); }
}

/** The Upstash REST credentials from the env: a complete UPSTASH_* pair first, else a complete KV_REST_API_* pair (read-write token only). */
export function upstashEnv(env: Record<string, string | undefined> = process.env): { url: string; token: string; source: "UPSTASH_REDIS_REST" | "KV_REST_API" } | undefined {
  // Off Vercel the shared store is opt-in (SHARED_STORE=1, e.g. scripts/seed-store.ts): a local test run that
  // merely inherits the KV env must never read or write the store production serves.
  if (!env.VERCEL && env.SHARED_STORE !== "1") return undefined;
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, source: "UPSTASH_REDIS_REST" };
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN, source: "KV_REST_API" };
  return undefined;
}

/** The in-memory seed file (test servers only): ignored on Vercel and whenever Upstash is configured, so it can never mask the real store. */
export function memorySeedPath(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.VERCEL || upstashEnv(env) || !env.MEMORY_STORE_SEED) return undefined;
  return env.MEMORY_STORE_SEED;
}

let memo: Store | undefined;
/** Upstash when an env pair is set (upstashEnv); else a file store when STORE_FILE_DIR is set; else in-memory (empty). */
export function getStore(): Store {
  if (memo) return memo;
  const up = upstashEnv();
  const seed = memorySeedPath();
  if (up) memo = new UpstashStore(up.url, up.token, up.source);
  else if (process.env.STORE_FILE_DIR) memo = new FileStore(path.resolve(process.env.STORE_FILE_DIR));
  // Test servers only (Playwright, off Vercel): start the in-memory store from a seed file written by scripts/seed-memory.ts.
  else if (seed) memo = new MemoryStore().load(JSON.parse(readFileSync(seed, "utf8")));
  else memo = new MemoryStore();
  return memo;
}
export function setStoreForTests(s: Store | undefined) { memo = s; }
