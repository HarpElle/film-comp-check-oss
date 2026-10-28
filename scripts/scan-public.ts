/**
 * Fails on any Qloo-derived literal or secret in the files git would commit. Its inputs are built at run
 * time from the PRIVATE local Qloo cache (.cache/, never committed), so this file holds no Qloo values:
 *  - every number in cached Qloo responses with 3+ decimals, at 3 to 6 decimals and as written, also when
 *    written regex-escaped (0\\.123 in a test);
 *  - the 3- to 6-decimal renderings of every computed fit, audience, gap and deck-lean delta (cached sample runs);
 *  - Qloo entity and tag IDs; 8-word runs from Qloo descriptions; director credits as parsed from Qloo text
 *    when they differ from the deck's own input;
 *  - secrets: QLOO_API_KEY / Anthropic key values from the env, sk-ant- and Bearer patterns.
 * Also fails on tracked files under lib/fixtures/, docs/ux-handoff/, qa/, .cache/, .data/, and PNG/JPG files.
 * Also fails on C2PA/JUMBF provenance data in any committed SVG or PNG (manifest text, namespaces, PNG caBX chunks).
 * Run: npx vitest run --config scripts/vitest.scripts.config.ts scripts/scan-public.ts
 * SCAN_ROOT=<checkout> scans another checkout (e.g. each commit of a history) with this repo's cache.
 * SCAN_STAGED=1 scans only the files staged for commit, as staged (the .githooks/pre-commit hook).
 * SCAN_SYNTHETIC=1 runs without the private cache (CI): the Qloo-value checks are skipped, while forbidden
 * paths, images, C2PA, key patterns and any key values present in the env are still checked. Without the
 * cache and without this flag the scan fails, so a missing cache never passes silently.
 */
import { it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { QlooClient } from "@/lib/qloo";
import { liveDeps, runCheckWith } from "@/lib/check";
import { StubProvider } from "@/lib/agent";
import { DREAM_HACKERS, PENNYWELL } from "@/lib/demo";

const root = path.resolve(__dirname, "..");
const scanRoot = process.env.SCAN_ROOT ? path.resolve(process.env.SCAN_ROOT) : root;
const synthetic = process.env.SCAN_SYNTHETIC === "1", staged = process.env.SCAN_STAGED === "1";
/**
 * Explicit allowlist: invented test values whose 3-decimal rendering happens to equal some cached Qloo
 * number. Each is computed from the test's own made-up inputs (file, value, why).
 */
const ALLOW: { file: string; value: string; why: string }[] = [
  { file: "test/agent.test.ts", value: "0.030", why: "gap between invented Bravo/Alpha scores" },
  { file: "test/agent.test.ts", value: "0.010", why: "gap between invented Bravo/Alpha scores" },
  { file: "test/why.test.ts", value: "0.132", why: "mean of the invented FEM values" },
  { file: "test/why.test.ts", value: "0.175", why: "female gap from the invented FEM values" },
  { file: "test/fixtures/synthetic.ts", value: "0.029", why: "step in the synthetic age values" },
  { file: "*", value: "0.300", why: "SKEW_THRESHOLD, our own constant (0.3), written at 3 decimals in copy and tests" },
];
const fx = (set: Set<string>, x: number) => { for (const d of [3, 4, 5, 6]) set.add(Math.abs(x).toFixed(d)); };
function* walk(d: string): Generator<string> { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) yield* walk(p); else yield p; } }

it("no Qloo-derived literals or secrets in committed files", async () => {
  const cacheDir = path.join(root, ".cache");
  if (!synthetic) expect(existsSync(cacheDir), "needs the private local cache to build its inputs (or SCAN_SYNTHETIC=1 for the structural checks only)").toBe(true);
  const nums = new Set<string>(), ids = new Set<string>(), shingles = new Set<string>(), credits = new Set<string>();
  const visit = (v: unknown, key = "") => {
    if (typeof v === "number" && !Number.isInteger(v)) {
      const s = String(v); const dec = s.split(".")[1]?.length ?? 0;
      if (dec >= 3) { fx(nums, v); nums.add(s.replace(/^-/, "")); }
    } else if (typeof v === "string") {
      if (/^(entity_id|tag_id|id)$/.test(key) && v.length >= 8) ids.add(v);
      if (/description|short_description/.test(key)) { const w = v.split(/\s+/); for (let i = 0; i + 8 <= w.length; i++) shingles.add(w.slice(i, i + 8).join(" ")); }
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  if (!synthetic) for (const f of walk(cacheDir)) {
    if (!f.endsWith(".json")) continue;
    try { const e = JSON.parse(readFileSync(f, "utf8")); if (String(e.url ?? "").includes("qloo")) visit(e.body); } catch { /* skip */ }
  }
  const saved = process.env.QLOO_API_KEY;
  if (!synthetic) try {
    delete process.env.QLOO_API_KEY; // cache-only reads
    for (const deck of [PENNYWELL, DREAM_HACKERS]) {
      const q = new QlooClient();
      const r = await runCheckWith(deck, liveDeps(q, false), q.stats, { provider: new StubProvider() });
      for (const c of r.comps) {
        for (const x of [c.fit?.affinity, c.skew?.female, c.skew?.age, c.rank?.gapToNext]) if (typeof x === "number") fx(nums, x);
        for (const [x, m] of [[c.skew?.female, r.deckMean?.female], [c.skew?.age, r.deckMean?.age]]) if (typeof x === "number" && typeof m === "number") fx(nums, x - m);
        const d = c.match.directorInRecord;
        if (d && d !== c.match.input.director && / and |,/.test(d)) credits.add(d);
      }
      for (const x of [r.deckMean?.female, r.deckMean?.age]) if (typeof x === "number") fx(nums, x);
    }
  } finally { if (saved) process.env.QLOO_API_KEY = saved; }
  const secrets = [process.env.QLOO_API_KEY, process.env.ANTHROPIC_API_KEY, process.env.QLOO_ANTHROPIC_API_KEY].filter((s): s is string => !!s && s.length >= 12);

  const files = staged
    ? execSync("git diff --cached --name-only --diff-filter=ACMR -z", { cwd: scanRoot, encoding: "utf8" }).split("\0").filter(Boolean)
    : execSync("git ls-files -c -o --exclude-standard", { cwd: scanRoot, encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => existsSync(path.join(scanRoot, f)));
  // Staged mode reads the blob as staged (what the commit will hold), not the working copy.
  const read = (f: string): Buffer => (staged ? execFileSync("git", ["show", `:${f}`], { cwd: scanRoot, maxBuffer: 64 << 20 }) : readFileSync(path.join(scanRoot, f)));
  const hits: string[] = [], notes: string[] = [];
  const numRe = /-?\d+\\?\.\d{3,}/g;
  for (const f of files) {
    if (/^(lib\/fixtures|docs\/ux-handoff|qa|\.cache|\.data)\//.test(f)) hits.push(`${f}: path must not be committed`);
    if (/\.(svg|png)$/i.test(f)) {
      const raw = read(f).toString("latin1");
      if (/c2pa|jumbf|jumb|contentauth|caBX/i.test(raw)) hits.push(`${f}: C2PA/JUMBF provenance data`);
    }
    if (/\.(png|jpe?g)$/i.test(f)) { hits.push(`${f}: image`); continue; }
    if (/package-lock\.json$|\.(woff2?|ico)$/.test(f)) continue;
    const text = read(f).toString("utf8");
    text.split("\n").forEach((line, i) => {
      const at = `${f}:${i + 1}`;
      for (const m of line.match(numRe) ?? []) {
        // A literal is compared at its own precision (as written; 3 or 6 decimals), not rounded down to 3.
        const bare = m.replace(/^-/, "").replace("\\", "");
        if (!nums.has(bare)) continue;
        if (ALLOW.some((a) => (a.file === "*" || a.file === f || f === "scripts/scan-public.ts") && a.value === bare)) { notes.push(`${at}: allowlisted ${bare}`); continue; }
        hits.push(`${at}: number ${m}`);
      }
      for (const t of line.match(/[0-9A-Za-z_:-]{8,}/g) ?? []) if (ids.has(t)) { hits.push(`${at}: Qloo id`); break; }
      for (const id of ids) if (id.length >= 16 && line.includes(id)) { hits.push(`${at}: Qloo id`); break; }
      for (const c of credits) if (line.includes(c)) hits.push(`${at}: Qloo director credit "${c}"`);
      for (const s of secrets) if (line.includes(s)) hits.push(`${at}: secret value`);
      if (/sk-ant-[A-Za-z0-9_-]{8,}|Bearer [A-Za-z0-9._-]{20,}/.test(line)) hits.push(`${at}: key pattern`);
    });
    const words = text.split(/\s+/);
    for (let i = 0; i + 8 <= words.length; i++) if (shingles.has(words.slice(i, i + 8).join(" "))) { hits.push(`${f}: Qloo description text "${words.slice(i, i + 8).join(" ")}"`); break; }
  }
  console.log(`scan${synthetic ? " (synthetic mode: no private cache, Qloo-value checks skipped)" : ""}${staged ? " (staged files)" : ""}: ${scanRoot === root ? "" : `${scanRoot}: `}${files.length} files; inputs: ${nums.size} number forms, ${ids.size} ids, ${shingles.size} description runs, ${credits.size} credits, ${secrets.length} secrets`);
  console.log([hits.length ? hits.join("\n") : "scan: no hits", ...notes.map((n) => `note: ${n}`)].join("\n"));
  expect(hits).toEqual([]);
}, 120_000);
