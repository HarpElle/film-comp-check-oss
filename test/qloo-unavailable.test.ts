/**
 * Qloo can't be reached (no key, monthly quota used up, network error, or some searches failing): the run
 * ends with a plain error event, never a verdict. A real no-match (Qloo answered, found nothing) still runs.
 * Synthetic data only; fetch is mocked, nothing leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { QlooClient } from "@/lib/qloo";
import { liveDeps, runCheckWith } from "@/lib/check";
import { StubProvider } from "@/lib/agent";
import { checkEventStream } from "@/lib/stream";
import { readEvents } from "@/lib/events";
import { CANT_REACH, QUOTA_USED_UP } from "@/lib/tools";

const DECK = [{ title: "Film Alpha", year: 2001 }, { title: "Film Beta", year: 2002 }, { title: "Film Gamma", year: 2003 }];
const FORBIDDEN = [/of \d+ comps matched/, /No audience outlier/, /No lowest-fit label/, /No Qloo calls were needed/, /no comp clearly stands apart/];

async function run() {
  const q = new QlooClient({ bypassCache: true, minGapMs: 0 });
  const out = [];
  for await (const e of readEvents(checkEventStream((on) => runCheckWith(DECK, liveDeps(q, true), q.stats, { provider: new StubProvider(), onEvent: on }), DECK.length))) out.push(e);
  return out;
}
function expectPlainError(ev: Awaited<ReturnType<typeof run>>, message: string) {
  expect(ev.at(-1)).toEqual({ type: "error", error: message });
  expect(ev.some((e) => e.type === "core_result" || e.type === "result")).toBe(false);
  const all = JSON.stringify(ev);
  for (const f of FORBIDDEN) expect(all).not.toMatch(f);
}
const qloo = (u: unknown) => String(u).includes("qloo");
const record = (name: string, year: number, id: string) => ({ name, entity_id: id, properties: { release_year: year, description: `A film directed by Jane Example.` }, tags: [] });

describe("Qloo unavailable", () => {
  // The real no-match case writes mocked /search bodies through the raw cache: keep them out of the repo's .cache/.
  let tmp = "";
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), "qloo-unavail-")); vi.stubEnv("COMP_CACHE_DIR", tmp); });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(tmp, { recursive: true, force: true }); });

  it("key unset: no request, plain error", async () => {
    vi.stubEnv("QLOO_API_KEY", "");
    const fetch = vi.spyOn(globalThis, "fetch");
    const ev = await run();
    expect(fetch).not.toHaveBeenCalled();
    expectPlainError(ev, CANT_REACH);
  });

  it("monthly quota used up (429, x-month-ratelimit-remaining: 0): no backoff, plain quota error", async () => {
    vi.stubEnv("QLOO_API_KEY", "test-key-not-real");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response('{"error":"rate limited"}', { status: 429, headers: { "x-month-ratelimit-remaining": "0", "x-month-ratelimit-limit": "100" } }));
    const t0 = Date.now();
    const ev = await run();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(fetch.mock.calls.every(([u]) => qloo(u))).toBe(true);
    expect(fetch.mock.calls.length).toBe(DECK.length); // one search each, no retries
    expectPlainError(ev, QUOTA_USED_UP);
  });

  it("network error on search: plain error", async () => {
    vi.stubEnv("QLOO_API_KEY", "test-key-not-real");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new TypeError("fetch failed"); });
    expectPlainError(await run(), CANT_REACH);
  });

  it("auth refused (401): plain error", async () => {
    vi.stubEnv("QLOO_API_KEY", "test-key-not-real");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 401 }));
    expectPlainError(await run(), CANT_REACH);
  });

  it("only some searches fail: still an error, no partial verdict", async () => {
    vi.stubEnv("QLOO_API_KEY", "test-key-not-real");
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      if (!qloo(u)) throw new Error("no Wikipedia here");
      if (++n === 2) throw new TypeError("fetch failed");
      const t = new URL(String(u)).searchParams.get("query")!;
      const d = DECK.find((c) => c.title === t)!;
      return new Response(JSON.stringify({ results: [record(d.title, d.year, `id-${n}`)] }), { status: 200 });
    });
    expectPlainError(await run(), CANT_REACH);
  });

  it("a real no-match (Qloo answered, nothing found) is Unmatched, not an error", async () => {
    vi.stubEnv("QLOO_API_KEY", "test-key-not-real");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      if (!qloo(u)) throw new Error("no Wikipedia here");
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    const ev = await run();
    const last = ev.at(-1)!;
    expect(last.type).toBe("result");
    expect(last.type === "result" && last.result.comps.every((c) => c.match.badge === "Unmatched")).toBe(true);
  });
});
