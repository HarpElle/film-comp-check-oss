/**
 * A mocked Qloo for tests (no Qloo data: it answers from synthetic recordings). Used in-process by unit tests
 * (handle()) and as a small HTTP server by e2e/run-live-sample.sh (node e2e/mock-qloo.mjs <port> <recordings.json>).
 * Answers /search, /v2/insights (deck fit and demographics) the way lib/qloo.ts reads them, with
 * x-month-ratelimit-remaining counting down per call. POST /__mock sets { drift: { <title>: <delta> }, remaining };
 * GET /__mock returns { calls, remaining }.
 */
import http from "node:http";
import { readFileSync } from "node:fs";

const deckKey = (titles) => [...titles].sort().join(" | ");

export function createMock(recordings, opts = {}) {
  const state = { calls: 0, remaining: opts.remaining ?? 100000, drift: opts.drift ?? {} };
  const ents = [];
  recordings.forEach((rec, r) => rec.comps.forEach((c, i) => ents.push({ id: `mockent-${r}-${i}`, rec, c, i })));
  const byId = new Map(ents.map((e) => [e.id, e]));
  const entity = (e) => ({
    entity_id: e.id, name: e.c.match.matchedTitle, popularity: 0.5,
    properties: { release_year: e.c.match.matchedYear, description: `${e.c.match.matchedTitle} (${e.c.match.matchedYear}), directed by ${e.c.input.director ?? "Sam Placeholder"} and starring Pat Placeholder, is a film.` },
    tags: [{ tag_id: "urn:tag:genre:mock:drama", name: "Drama", type: "urn:tag:genre:media" }, { tag_id: `urn:tag:keyword:mock:k${e.i}`, name: `Mock keyword ${e.i}`, type: "urn:tag:keyword:media" }],
  });
  function handle(urlStr) {
    const u = new URL(urlStr);
    state.calls++; state.remaining = Math.max(0, state.remaining - 1);
    const p = u.searchParams;
    let body;
    if (u.pathname === "/search") {
      const q = (p.get("query") ?? "").toLowerCase();
      body = { results: ents.filter((e) => e.c.match.matchedTitle.toLowerCase() === q).map(entity) };
    } else if (u.pathname === "/v2/insights" && p.get("filter.type") === "urn:demographics") {
      const e = byId.get(p.get("signal.interests.entities"));
      const a = e?.c.audience ?? {};
      body = { results: { demographics: e ? [{ query: { gender: { female: a.female, male: -a.female }, age: { "24_and_younger": 0, "25_to_29": 0, "30_to_34": 0, "35_to_44": 0, "45_to_54": a.age, "55_and_older": a.age } } }] : [] } };
    } else if (u.pathname === "/v2/insights") {
      const others = (p.get("signal.interests.entities") ?? "").split(",").map((id) => byId.get(id)).filter(Boolean);
      const t = byId.get(p.get("filter.results.entities"));
      const title = t?.c.match.matchedTitle;
      const fit = t ? t.rec.fit[deckKey([...others.map((o) => o.c.match.matchedTitle), title])]?.[title] : undefined;
      body = { results: { entities: typeof fit === "number" ? [{ entity_id: t.id, name: title, query: { affinity: +(fit + (state.drift[title] ?? 0)).toFixed(6) } }] : [] } };
    } else return { status: 404, headers: {}, body: { error: "not mocked" } };
    return { status: 200, headers: { "x-month-ratelimit-remaining": String(state.remaining) }, body };
  }
  return { state, handle };
}

/** A fetch stand-in for unit tests: Qloo URLs go to the mock, anything else fails loudly. */
export function mockFetch(mock) {
  return async (input) => {
    const url = String(input);
    if (!/\/search\?|\/v2\/insights\?/.test(url)) throw new Error(`unexpected fetch ${url}`);
    const r = mock.handle(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...r.headers } });
  };
}

if (process.argv[1] && process.argv[1].endsWith("mock-qloo.mjs")) {
  const [port, file] = process.argv.slice(2);
  const mock = createMock(JSON.parse(readFileSync(file, "utf8")));
  http.createServer((req, res) => {
    const send = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith("/__mock")) {
      if (req.method === "POST") {
        let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { const b = JSON.parse(d || "{}"); if (b.drift) mock.state.drift = b.drift; if (typeof b.remaining === "number") mock.state.remaining = b.remaining; if (b.reset) mock.state.calls = 0; send(200, mock.state); });
      } else send(200, mock.state);
      return;
    }
    const r = mock.handle(`http://mock${req.url}`);
    send(r.status, r.body, r.headers);
  }).listen(Number(port), "127.0.0.1");
}
