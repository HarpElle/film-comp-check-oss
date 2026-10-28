import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Private file cache keyed by URL. Lives under .cache/ (git-ignored). Never stores request headers. */
/** COMP_CACHE_DIR (e.g. /tmp/comp-cache on Vercel) or .cache/ locally. Read per call so tests and hosts can set it. */
export function cacheRoot(): string {
  return process.env.COMP_CACHE_DIR || path.join(process.cwd(), ".cache");
}

function fileFor(url: string): string {
  const h = createHash("sha256").update(url).digest("hex");
  return path.join(cacheRoot(), h.slice(0, 2), h + ".json");
}

export async function cacheGet<T>(url: string): Promise<T | undefined> {
  return (await cacheGetEntry<T>(url))?.body;
}

export async function cacheGetEntry<T>(url: string): Promise<{ body: T; savedAt?: string } | undefined> {
  try {
    const raw = await fs.readFile(fileFor(url), "utf8");
    return JSON.parse(raw) as { body: T; savedAt?: string };
  } catch {
    return undefined;
  }
}

/** Best effort: a failed cache write (read-only disk, full /tmp, bad path) never breaks a run. Returns false on failure. */
export async function cachePut<T>(url: string, body: T): Promise<boolean> {
  try {
    const f = fileFor(url);
    await fs.mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ url, savedAt: new Date().toISOString(), body }));
    await fs.rename(tmp, f);
    return true;
  } catch {
    return false;
  }
}
