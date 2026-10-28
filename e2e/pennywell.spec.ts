import { FOLDED } from "../lib/copy";
import { test, expect, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertMap, assertNoScroll, assertNoteMarkers, assertRenames, detail, editComps, openExport, openSteps, row, waitIdle } from "./helpers";
import { EXPECTED } from "./expected";

const E = EXPECTED?.pennywell, ER = EXPECTED?.pennywellWithoutMidsommar, ED = EXPECTED?.dreamhackers;
/** The comp the lowest-fit label lands on, read from the page (one row carries it). */
async function lowestTitle(page: Page) { return (await page.locator('[data-testid="comp-row"]:has(.flag.cut, .flag.close)').first().getAttribute("data-title"))!; }

const QA = path.join(__dirname, "..", "qa");
const FIXED = "This checks comps. It does not predict box office or revenue."; // export line
const LIMITS = "It doesn't predict box office, and it doesn't catch a same-genre hit added to make a deck look bigger.";
const PENNYWELL = ["The Witch", "Winchester", "Get Out", "It Comes at Night", "Ma", "Midsommar"];

async function scores(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of await page.getByTestId("comp-row").all()) out[(await r.getAttribute("data-title"))!] = (await r.getByTestId("score").getAttribute("data-score"))!;
  return out;
}
async function calls(page: Page): Promise<string> { return (await page.getByTestId("calls").innerText()).trim(); }
const timings: Record<string, number> = {};
const log: string[] = [];

test.describe.serial("Pennywell flow", () => {
  // This flow runs Pennywell on a plain server with no store: with no Qloo key the sample has nothing to run on and
  // step a stops at 0 comp rows. It needs live Qloo, so it runs only when live runs are enabled (E2E_LIVE=1 plus QLOO_API_KEY).
  // Offline coverage of the same screens: e2e/recorded.spec.ts and e2e/live-sample.spec.ts (mocked Qloo).
  test.skip(process.env.E2E_LIVE !== "1" || !process.env.QLOO_API_KEY, "needs live Qloo: set E2E_LIVE=1 with QLOO_API_KEY");
  let page: Page;
  let afterRemove: Record<string, string> = {};
  let full: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    await fs.mkdir(QA, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  });
  test.afterAll(async () => {
    await fs.writeFile(path.join(QA, "qa-log.txt"), [...log, JSON.stringify(timings)].join("\n") + "\n");
    await page.close();
  });

  test("a. load Pennywell and run the check", async () => {
    await page.goto("/");
    const text = await page.locator("#comps").inputValue();
    for (const t of PENNYWELL) expect(text).toContain(t);
    // Landing copy, verbatim.
    await expect(page.locator("h1")).toHaveText("Film Comp Check");
    await expect(page).toHaveTitle("Film Comp Check");
    await expect(page.getByTestId("purpose")).toHaveText("Check whether each film on your comp slide belongs there.");
    await expect(page.getByTestId("intro")).toHaveText("For producers checking a comp slide before it goes to investors.");
    // The four explainer parts, folded into two lines by cutting only (test/copy.test.ts checks the cut).
    await expect(page.getByTestId("about-line")).toHaveText([...FOLDED]);
    // This server has no store configured: the landing shows no sample snippet (never hardcoded). e2e/recorded.spec.ts covers the seeded store.
    await expect(page.getByTestId("sample-verdict")).toHaveCount(0);
    await expect(page.getByTestId("privacy-footer")).toHaveText("Nothing is saved to an account. To save Qloo calls, the comp titles you enter are cached for 30 days. Daily limits count visits by a hashed IP, which is kept for 48 hours.");
    await expect(page.getByTestId("appbar")).toContainText("Film Comp Check");
    expect(await page.locator('link[rel="icon"]').count()).toBeGreaterThan(0);
    await expect(page.getByTestId("limits-footer")).toHaveText(LIMITS); // small text, on the landing and the results screen
    await expect(page.getByTestId("contact")).toHaveCount(0); // contact footer removed
    await expect(page.getByText("info@filmcompcheck.com")).toHaveCount(0);
    // Title, purpose, sub line and the button sit above the fold at 1280x800, with no scrolling.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const loc of [page.locator("h1"), page.getByTestId("purpose"), page.getByTestId("intro"), page.getByRole("button", { name: "Try the Pennywell sample" })]) {
      await expect(loc).toBeInViewport({ ratio: 1 });
      const box = (await loc.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    }
    await expect(page.locator("#comps")).toBeVisible(); // the paste box stays available
    // The whole landing, competitor line and price included, fits in 1280x800.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);
    const foot = (await page.locator("footer").boundingBox())!;
    expect(foot.y + foot.height).toBeLessThanOrEqual(800);
    await expect(page.getByText("$599 for 10 films from FilmProposals", { exact: false })).toBeVisible();
    await expect(page.getByText("How it differs: Other tools help you find or build comps.", { exact: false })).toBeVisible();
    await page.screenshot({ path: path.join(QA, "design2-landing.png") });
    await page.locator("#comps").fill("");
    await page.screenshot({ path: path.join(QA, "01-loaded.png") });
    const t0 = Date.now();
    // One click loads Pennywell and runs the check.
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await expect(page.getByTestId("comp-row")).toHaveCount(6);
    await waitIdle(page);
    await openSteps(page);
    await expect(page.getByTestId("steps")).toBeVisible();
    timings.firstRunMs = Date.now() - t0;
    log.push(`a ${await calls(page)}`);

    await expect(page.locator(".badge.Matched")).toHaveCount(6);
    await editComps(page);
    for (const t of PENNYWELL) expect(await page.locator("#comps").inputValue()).toContain(t); // the sample was loaded too
    await page.getByRole("button", { name: "Close" }).click();
    // Director lines: the record's credit as written (expected values from the local cache when present).
    for (const r of await page.getByTestId("comp-row").all()) {
      const t = (await r.getAttribute("data-title"))!;
      if (E?.rows[t]?.director) await expect(r.getByTestId("director")).toHaveText(E.rows[t].director!);
      else if (await r.getByTestId("director").count()) await expect(r.getByTestId("director")).toHaveText(/^Dir\. \S/);
    }
    // Locked label rule: exactly one lowest-fit label, on the lowest-ranked row.
    await expect(page.locator(".flag.close, .flag.cut")).toHaveCount(1);
    const low = await lowestTitle(page);
    await expect(row(page, low).getByTestId("rank")).toHaveText(/^6 of 6 \u00b7 0\.\d{3} below next$/);
    if (E) { expect(low).toBe(E.lowest[0].title); await expect(row(page, low).locator(".flag")).toContainText(E.lowest[0].label); }
    for (const r of await page.getByTestId("comp-row").all()) {
      const t = (await r.getAttribute("data-title"))!;
      await expect(r.getByTestId("score")).toHaveText(E?.rows[t]?.score3 ?? /^0\.\d{3}$/);
      await expect(r.getByTestId("rank")).toHaveText(E?.rows[t]?.rank ?? /^\d of 6 \u00b7 (0\.\d{3} below next|top fit)$/);
    }
    // Gaps are self-consistent: each "below next" equals the next-higher score minus this one (3 decimals, +-0.001).
    const sc = await scores(page), sorted = Object.entries(sc).sort((a, b) => Number(b[1]) - Number(a[1]));
    for (let i = 1; i < sorted.length; i++) {
      const txt = await row(page, sorted[i][0]).getByTestId("rank").innerText();
      expect(Math.abs(Number(txt.match(/(0\.\d{3}) below next/)![1]) - (Number(sorted[i - 1][1]) - Number(sorted[i][1])))).toBeLessThanOrEqual(0.0011);
    }
    await expect(row(page, sorted[0][0]).getByTestId("rank")).toHaveText("1 of 6 \u00b7 top fit");
    // Verdict above the log, built from tool outputs.
    const verdict = page.getByTestId("verdict");
    // Verdict: matched count, then the audience line, then the fit line.
    const vl = await page.getByTestId("verdict-line").allInnerTexts();
    expect(vl).toHaveLength(3);
    expect(vl[0]).toBe("6 of 6 comps matched.");
    expect(vl[1]).toMatch(/^(No audience outlier\.|Audience outlier: .+ brings (an older|a younger|a more female|a more male) audience than the rest of your comps \(Qloo's estimate\)\. Check it\.|Audience split: .+ skew differently \(Qloo's estimate\)\.)$/);
    expect(vl[2]).toContain(`${low} (${await row(page, low).getByTestId("score").innerText()}, `); // the fit line names the labeled row with its shown score
    if (E) expect(vl).toEqual(E.verdictLines);
    log.push(`verdict ${JSON.stringify(await page.getByTestId("verdict-line").allInnerTexts())}`);
    // Deck map, layout rules, renames.
    await assertMap(page, E?.outliers);
    await assertNoScroll(page);
    await assertRenames(page);
    await page.screenshot({ path: path.join(QA, "design2-results-pennywell.png") });
    await openSteps(page);
    const vy = (await verdict.boundingBox())!.y, sy = (await page.getByTestId("steps").boundingBox())!.y;
    expect(vy).toBeLessThan(sy);
    // One resolve line, per-comp detail on click.
    await expect(page.locator('[data-testid="steps"] li[data-action="resolve_comps"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="steps"] li[data-action="resolve_comp"]')).toHaveCount(0);
    const resolve = page.locator('[data-testid="steps"] li[data-action="resolve_comps"]');
    await expect(resolve.locator("summary")).toContainText(E?.resolveSummary ?? "Matched 6 of 6 comps to Qloo movie records");
    await expect(resolve.locator("ul.details li").first()).toBeHidden();
    await page.getByTestId("always-run").evaluate((d) => { (d as HTMLDetailsElement).open = true; }); // resolve_comps always runs, so it sits in the folded group
    await resolve.locator("summary").click();
    await expect(resolve.locator("ul.details li")).toHaveCount(6);
    await expect(resolve.locator("ul.details li").first()).toBeVisible();
    await resolve.locator("summary").click();
    await expect(page.getByRole("heading", { name: /Agent steps/ })).toBeVisible();
    // The single audience outlier, read from the page (expected from the cache when present).
    const out = (await page.locator('[data-testid="comp-row"]:has(.flag.skew)').first().getAttribute("data-title"))!;
    if (E) expect(out).toBe(E.outliers[0]);
    // Popularity is context, not a flag.
    await expect(detail(page, out).getByTestId("popularity")).toContainText("Wikipedia views");
    // The bars live in the comp detail: hidden until the comp is opened, labeled, with the row's marker.
    await expect(detail(page, out)).toBeHidden();
    await row(page, out).getByTestId("comp-toggle").click();
    await expect(detail(page, out).getByTestId("bar")).toHaveCount(2);
    await expect(detail(page, out).getByTestId("bar-label")).toHaveText(["Age gap", "Female gap"]);
    await expect(detail(page, out).getByTestId("bar-value").first()).toHaveText(E?.outlierAgeBar ?? /^[+\u2212]0\.\d{3}( outlier| split)?$/);
    await expect(detail(page, out).getByTestId("bars")).toContainText("Qloo's estimate");
    await expect(detail(page, out).getByTestId("bars")).toContainText("Audience outlier marker");
    await assertRenames(page);
    await row(page, out).getByTestId("comp-toggle").click();
    await expect(detail(page, out)).toBeHidden();
    await expect(page.locator('[data-testid="flag"]', { hasText: "Wikipedia" })).toHaveCount(0);
    await expect(page.getByTestId("legend")).toHaveText("Fit score: how well this comp fits with the rest of your list, scored by Qloo the same way every time. Higher fits better. Open a comp for its Why lines and audience bars.");
    await expect(page.getByTestId("calls")).toHaveText(/^Qloo results cached at [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M CT\. Run again calls Qloo live\.$/);
    await expect(row(page, out).locator(".flag", { hasText: "Audience outlier" })).toBeVisible();
    await expect(page.locator(".flag", { hasText: "Audience outlier" })).toHaveCount(1);
    // Accent bar on the single audience outlier, never on the close-call row.
    await expect(row(page, out)).toHaveClass(/\baccent\b/);
    await expect(page.locator("tr.accent")).toHaveCount(1);
    await expect(row(page, low)).not.toHaveClass(/\baccent\b/);
    await expect(row(page, low)).not.toHaveClass(/\bcut\b/);
    const bar = await row(page, out).locator("td").first().evaluate((el) => getComputedStyle(el).borderLeftWidth);
    expect(bar).toBe("4px");
    expect(await row(page, low).locator("td").first().evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe("0px");
    await openSteps(page);
    await expect(page.getByTestId("steps")).toBeVisible();
    await expect(page.locator('[data-testid="steps"] li[data-action="score_deck"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="steps"] li[data-action="finish"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="steps"] li', { hasText: "Rejected" })).toHaveCount(0);
    // Every step says whether it always runs or was chosen; the stub chooses pageviews, then stop.
    const tags = await page.locator('[data-testid="steps"] li[data-n] > [data-testid="origin"], [data-testid="steps"] li[data-n] > details > summary > [data-testid="origin"]').allInnerTexts();
    expect(tags.length).toBe(await page.locator('[data-testid="steps"] li[data-n]').count());
    expect(new Set(tags)).toEqual(new Set(["Always runs", "Rule chose"]));
    await expect(page.locator('[data-testid="steps"] li[data-origin="stub"] [data-testid="choice"]')).toHaveText([/^pageview check on The Witch, Winchester, Get Out, It Comes at Night, Ma, Midsommar/, E?.stopChoice?.basis ? `stop (${E.stopChoice.basis.phrase} ${E.stopChoice.basis.value})` : /^stop \(gap to next 0\.\d{3}\)$/]);
    await expect(page.locator('[data-testid="steps"] li[data-origin="model"]')).toHaveCount(0);
    await expect(page.getByTestId("why").filter({ hasText: "Qloo tags:" })).toHaveCount(0);
    await expect(page.getByTestId("limits-footer")).toHaveText(LIMITS); // limits stay on the results screen
    await expect(page.getByTestId("limits-footer")).toBeVisible();
    full = await scores(page);
    if (E) expect(full).toEqual(E.scores6);
    for (const v of Object.values(full)) expect(v).toMatch(/^0\.\d{6}$/);
    await assertNoteMarkers(page);
    await page.screenshot({ path: path.join(QA, "02-results.png"), fullPage: true });
  });

  test("b. remove Midsommar and recompute", async () => {
    // Watch the whole removal: the table must never disappear (a cached recompute updates in place).
    await page.evaluate(() => {
      const w = window as unknown as { __rm: { blank: number; muts: number; busySeen: boolean } };
      w.__rm = { blank: 0, muts: 0, busySeen: false };
      new MutationObserver(() => {
        w.__rm.muts++;
        if (document.querySelector('[data-testid="busy"]')) w.__rm.busySeen = true;
        if (!document.querySelector('[data-testid="results"]')) w.__rm.blank++;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await page.getByRole("button", { name: "Remove Midsommar" }).click();
    await expect(page.getByTestId("comp-row")).toHaveCount(5);
    await waitIdle(page);
    await expect(row(page, "Midsommar")).toHaveCount(0);
    await editComps(page);
    expect(await page.locator("#comps").inputValue()).not.toContain("Midsommar");
    await page.getByRole("button", { name: "Close" }).click();
    afterRemove = await scores(page);
    log.push(`b ${await calls(page)} ${JSON.stringify(afterRemove)}`);
    let changed = 0;
    for (const [t, v] of Object.entries(afterRemove)) { expect(v).toMatch(/^0\.\d{6}$/); if (v !== full[t]) changed++; }
    expect(changed).toBe(5);
    // A removal starts a fresh deck run: the log shows the deck being scored without Midsommar.
    await expect(page.locator('[data-testid="steps"] li[data-action="score_deck"], [data-testid="steps"] li[data-action="rerun"]')).not.toHaveCount(0);
    await expect(page.locator('[data-testid="steps"] li[data-action="resolve_comps"] summary')).toContainText("Matched 5 of 5 comps");
    await expect(page.locator(".flag.close, .flag.cut")).toHaveCount(1);
    const lowR = await lowestTitle(page);
    const label = await row(page, lowR).locator(".flag.cut, .flag.close").innerText();
    if (ER) { expect(lowR).toBe(ER.lowest[0].title); expect(label).toContain(ER.lowest[0].label); expect(await page.getByTestId("verdict-line").allInnerTexts()).toEqual(ER.verdictLines); expect(await scores(page)).toEqual(ER.scores6); }
    log.push(`b label ${label.trim().replace(/\s+/g, " ")} | verdict ${JSON.stringify(await page.getByTestId("verdict-line").allInnerTexts())}`);
    await expect(page.getByTestId("calls")).toHaveText(/^(Live: \d+ Qloo calls? just now\.( The rest were cached at .* CT\. Run again calls Qloo live\.)?|Qloo results cached at .* CT\. Run again calls Qloo live\.)$/);
    const rm = await page.evaluate(() => (window as unknown as { __rm: { blank: number; muts: number; busySeen: boolean } }).__rm);
    log.push(`b remove watch ${JSON.stringify(rm)}`);
    expect(rm.busySeen).toBe(true);
    expect(rm.blank).toBe(0);
    await expect(page.getByTestId("calls")).toHaveText(/^Qloo results cached at .* CT\. Run again calls Qloo live\.$/); // zero Qloo calls
    await page.screenshot({ path: path.join(QA, "03-after-remove.png"), fullPage: true });
  });

  test("c. run again bypasses the cache and repeats exactly", async () => {
    // Live Qloo calls (15). Off by default: the hackathon key's monthly quota is used up (x-month-ratelimit-remaining: 0).
    test.skip(!process.env.QA_LIVE, "QA_LIVE not set: no live Qloo calls");
    const pickBefore = await page.locator(".flag.cut, .flag.close").locator("xpath=ancestor::tr").getAttribute("data-title");
    const labelBefore = await page.locator(".flag.cut, .flag.close").innerText();
    const verdictBefore = await page.getByTestId("verdict").innerText();
    // Record, inside the page, when the click happens and when each live step line appears.
    await page.evaluate(() => {
      const w = window as unknown as { __qa: { click?: number; lines: { t: number; n: number }[]; done?: number } };
      w.__qa = { lines: [] };
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Run again")!;
      btn.addEventListener("click", () => { w.__qa.click = performance.now(); }, { capture: true, once: true });
      const obs = new MutationObserver(() => {
        const n = document.querySelectorAll('[data-testid="live-steps"] > li').length;
        const last = w.__qa.lines.at(-1);
        if (n > 0 && (!last || last.n !== n)) w.__qa.lines.push({ t: performance.now(), n });
        if (w.__qa.click && !document.querySelector('[data-testid="live"]') && document.querySelector('[data-testid="results"]') && !w.__qa.done) w.__qa.done = performance.now();
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const t0 = Date.now();
    await page.getByRole("button", { name: "Run again" }).click();
    await expect(page.getByTestId("busy")).toBeVisible();
    await expect(page.getByTestId("live-steps").locator("> li").first()).toBeVisible({ timeout: 1500 });
    await expect(page.getByTestId("live-steps").locator("> li").first()).toContainText("resolve_comps");
    // Mid-run screenshot once a few steps have landed but the result has not.
    await expect.poll(async () => page.getByTestId("live-steps").locator("> li").count(), { timeout: 60_000, intervals: [100] }).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("live")).toBeVisible();
    await page.screenshot({ path: path.join(QA, "09-streaming.png"), fullPage: true });
    await waitIdle(page);
    timings.runAgainNoCacheMs = Date.now() - t0;
    const qa = await page.evaluate(() => (window as unknown as { __qa: { click: number; lines: { t: number; n: number }[]; done?: number } }).__qa);
    const first = qa.lines[0].t - qa.click;
    timings.coldFirstLineMs = Math.round(first);
    timings.coldTotalMs = Math.round((qa.done ?? qa.lines.at(-1)!.t) - qa.click);
    log.push(`stream lines ${JSON.stringify(qa.lines.map((l) => ({ n: l.n, ms: Math.round(l.t - qa.click) })))}`);
    expect(first).toBeLessThan(1500);
    // Incremental: several distinct step counts were seen, spread out in time, before the result.
    expect(qa.lines.length).toBeGreaterThanOrEqual(3);
    expect(qa.lines.at(-1)!.t - qa.lines[0].t).toBeGreaterThan(1000);
    const c = await calls(page);
    log.push(`c ${c}`);
    expect(c).toBe("Live: 15 Qloo calls just now.");
    expect(await page.locator(".flag.cut, .flag.close").innerText()).toBe(labelBefore);
    expect(await page.getByTestId("verdict").innerText()).toBe(verdictBefore);
    expect(await scores(page)).toEqual(afterRemove);
    const pickAfter = await page.locator(".flag.cut, .flag.close").locator("xpath=ancestor::tr").getAttribute("data-title");
    expect(pickAfter).toBe(pickBefore);
    log.push(`pick ${pickAfter}`);
    await page.screenshot({ path: path.join(QA, "04-run-again.png") });
  });

  test("d. export Markdown and CSV", async () => {
    const rows = await scores(page);
    await openExport(page);
    for (const [label, file] of [["Export Markdown", "comp-check.md"], ["Export CSV", "comp-check.csv"]] as const) {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
      expect(dl.suggestedFilename()).toBe(file);
      const dest = path.join(QA, file);
      await dl.saveAs(dest);
      const body = await fs.readFile(dest, "utf8");
      expect(body).toContain(FIXED);
      for (const [t, s] of Object.entries(rows)) { expect(body).toContain(t); expect(body).toContain(s); }
      expect(body.match(/Matched/g)!.length).toBeGreaterThanOrEqual(5);
      expect(body).toMatch(/Consider cutting|Lowest fit, close call/);
      expect(body).toContain("Fit with the other comps");
      expect(body).toContain("lowest fit with the other comps");
      expect(body).toContain("below the next comp");
      if (file.endsWith(".md")) expect(body.startsWith("# Film Comp Check\n")).toBe(true);
      // New export fields, labeled Qloo's estimate, 3 decimals.
      for (const h of ["female lean (Qloo's estimate)", "age lean (Qloo's estimate)", file.endsWith(".md") ? "skew distance, max of \\|age gap\\| and \\|female gap\\| (Qloo's estimate)" : "skew distance, max of |age gap| and |female gap| (Qloo's estimate)", "larger gap (Qloo's estimate)", "age gap vs deck mean (Qloo's estimate)", "female gap vs deck mean (Qloo's estimate)", file.endsWith(".md") ? "| age direction |" : "age direction (Qloo's estimate)"]) expect(body).toContain(h);
      // Larger gap: "age" or "female lean" on every comp with an estimate (this export is the 5-comp deck after the removal).
      expect(body).toMatch(file.endsWith(".md") ? /\| (age|female lean) \|/ : /"(age|female lean)"/);
      for (const [t, r] of Object.entries(ER?.rows ?? {})) if (r.largerGap) expect(body).toMatch(new RegExp(file.endsWith(".md") ? `\\| ${t} \\| [^\\n]*\\| ${r.largerGap} \\|` : `"${t}[^\\n]*"${r.largerGap}"`));
      if (file.endsWith(".md")) expect(body).toMatch(/Flagged as an audience outlier when skew distance is over 0\.300\./);
      expect(body).not.toMatch(/female share|age score|%/);
      if (file.endsWith(".md")) expect(body).toContain("Lean values are Qloo scores, not percentages. Age lean direction is older or younger than this deck.");
      // The computed deck-lean word follows the sign of the shown mean age lean.
      if (file.endsWith(".md")) {
        const m = body.match(/Deck mean, all comps: female lean -?\d\.\d{3} \(Qloo's estimate\); age lean (-?\d\.\d{3}) \(Qloo's estimate\)\. This deck leans (young|older) overall\./)!;
        expect(m).toBeTruthy();
        expect(m[2]).toBe(Number(m[1]) < 0 ? "young" : "older");
        if (ER?.deckLean) expect(m[2]).toBe(ER.deckLean);
      } else expect(body).toMatch(/deck mean female lean \(Qloo's estimate\)/);
    }
    await page.screenshot({ path: path.join(QA, "05-export.png") });
    await page.getByTestId("export-menu").evaluate((d) => { (d as HTMLDetailsElement).open = false; });
    // Printable one-page sheet: print media, Letter size, one page.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("steps")).toBeHidden();
    await expect(page.getByTestId("appbar").getByRole("button", { name: "Edit comps" })).toBeHidden();
    await expect(page.getByTestId("print-head")).toBeVisible();
    await page.screenshot({ path: path.join(QA, "design2-print.png"), fullPage: true });
    const pdf = await page.pdf({ format: "Letter", printBackground: true });
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
    await page.emulateMedia({ media: "screen" });
  });

  test("e. deuteranopia: every badge and flag has visible text, plus simulated screenshot", async () => {
    await assertLabeled(page);
    // The map reads without color: every point has its name, flagged points carry a word, the legend names each shape.
    // Design spec, map: labels on flagged comps only, no legend; the crosshair is labeled "deck average".
    await expect(page.getByTestId("map-flag")).toHaveText(["Audience outlier"]);
    await expect(page.getByTestId("map-legend")).toHaveCount(0);
    await expect(page.getByTestId("map-avg-label")).toHaveText("deck average");
    await assertRenames(page);
    await simulateDeuteranopia(page);
    await page.screenshot({ path: path.join(QA, "06-deuteranopia.png"), fullPage: true });
    await page.evaluate(() => { document.documentElement.style.filter = ""; document.getElementById("deut-svg")?.remove(); });
  });

  test("f. all badge kinds carry text (mocked API, invented data)", async () => {
    if (page.url() === "about:blank") await page.goto("/");
    // The page reads an NDJSON stream: start, steps, result.
    // Tag notes from a template step and a stub step: each Why-line marker must name its own step's origin.
    const noteA = "Qloo tags: shares 1 of 2 with the rest of the deck (invented).", noteB = "Qloo tags: shares 2 of 3 with the rest of the deck (invented).";
    const mock = structuredClone(MOCK) as typeof MOCK & { steps: Record<string, unknown>[]; comps: { key: string; reasons: string[] }[] };
    mock.steps.push(
      { n: 20, action: "tag_look", origin: "template", reason: "Invented.", choice: { label: "closer look at Alpha's tags" }, outcome: "Done.", note: { comp: "c1", text: noteA } },
      { n: 21, action: "tag_look", origin: "stub", reason: "Invented.", choice: { label: "closer look at Bravo's tags" }, outcome: "Done.", note: { comp: "c2", text: noteB } },
    );
    mock.comps[0].reasons.push(noteA); mock.comps[1].reasons.push(noteB);
    const ndjson = [{ type: "start", at: "mock", comps: 4 }, { type: "step", phase: "done", step: MOCK.steps[0] }, { type: "result", result: mock }].map((e) => JSON.stringify(e)).join("\n") + "\n";
    await page.route(/\/api\/check/, (r) => r.fulfill({ contentType: "application/x-ndjson", body: ndjson }));
    await editComps(page);
    await page.locator("#comps").fill("Alpha | 2001\nBravo | 2002\nCharlie | 2003\nDelta | 2004");
    await page.getByRole("button", { name: "Check comps" }).click();
    await expect(page.getByTestId("comp-row")).toHaveCount(4);
    for (const label of ["Matched", "Unmatched", "Unscored", "Set aside", "Consider cutting", "Audience outlier", "Thin record"]) {
      await expect(page.locator('[data-testid="badge"], [data-testid="flag"]').filter({ hasText: label }).first()).toBeVisible();
    }
    await assertLabeled(page);
    await assertNoteMarkers(page);
    await expect(detail(page, "Alpha").getByTestId("note-marker")).toHaveText("Template \u00b7 step 20 \u2193");
    await expect(detail(page, "Bravo").getByTestId("note-marker")).toHaveText("Rule chose \u00b7 step 21 \u2193");
    await page.screenshot({ path: path.join(QA, "07-all-badges-mock.png"), fullPage: true });
    await page.unroute(/\/api\/check/);
  });

  test("f2. error state: plain words, Try again, no verdict", async ({ browser }) => {
    // A fresh page: a first run has no earlier result to keep on screen, so the loading state shows.
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto("/");
    // Held for a moment first, so the designed loading state can be seen and captured.
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    await page.route(/\/api\/check/, async (r) => { await held; await r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Qloo did not answer in time." }) }); });
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await expect(page.getByTestId("loading-state")).toBeVisible();
    await expect(page.getByTestId("loading-state")).toContainText("Checking 6 comps with Qloo.");
    await expect(page.getByTestId("skeleton-row")).toHaveCount(6);
    await expect(page.getByTestId("map-placeholder")).toBeVisible();
    // Mid-run (before any step): verdict area, all six rows and the one-line live status fit at 1280x800.
    await expect(page.getByTestId("live-status")).toHaveText("Starting the check");
    for (const el of [page.getByTestId("loading-state"), page.getByTestId("live-status"), ...(await page.getByTestId("skeleton-row").all())]) {
      const b = (await el.boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(800);
    }
    expect((await page.getByTestId("live-status").boundingBox())!.height).toBeLessThan(24);
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
    await page.screenshot({ path: path.join(QA, "design2-loading.png") });
    release();
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByTestId("error-state")).toContainText("Check failed.");
    await expect(page.getByTestId("error-headline")).toHaveText("Qloo isn't answering right now");
    await expect(page.getByTestId("error-detail")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByTestId("verdict")).toHaveCount(0);
    await page.screenshot({ path: path.join(QA, "design2-error.png") });
    await page.unroute(/\/api\/check/);
    // A deck that can't be checked yet gets a field message, not a run.
    await editComps(page);
    await page.locator("#comps").fill("Alpha | 2001");
    await page.getByRole("button", { name: "Check comps" }).click();
    await expect(page.getByTestId("field-error-headline")).toHaveText("Add at least 3 comps");
    await page.close();
  });

  test("g. Dream Hackers deck", async () => {
    if (page.url() === "about:blank") await page.goto("/");
    await editComps(page);
    await page.locator("#comps").fill(["Blade Runner | 1982 | Ridley Scott", "Ex Machina | 2014 | Alex Garland", "Her | 2013 | Spike Jonze", "Minority Report | 2002 | Steven Spielberg", "I, Robot | 2004 | Alex Proyas"].join("\n"));
    const t0 = Date.now();
    await page.getByRole("button", { name: "Check comps" }).click();
    await expect(page.getByTestId("comp-row")).toHaveCount(5);
    await expect(page.getByTestId("verdict-line")).toHaveCount(3);
    await waitIdle(page);
    timings.dreamHackersMs = Date.now() - t0;
    const lines = await page.getByTestId("verdict-line").allInnerTexts();
    log.push(`dreamhackers ${await calls(page)} ${JSON.stringify(lines)}`);
    expect(lines[0]).toBe("5 of 5 comps matched.");
    // k >= 2: dashed split marker on each listed comp, no accent bar anywhere.
    if (lines[1].startsWith("Audience split:")) {
      await expect(page.locator("tr.accent")).toHaveCount(0);
      expect(await page.locator(".flag.split").count()).toBeGreaterThanOrEqual(2);
    }
    await assertLabeled(page);
    await assertNoteMarkers(page);
    await assertMap(page, ED ? [...ED.outliers, ...ED.splits] : undefined);
    if (ED) { expect(lines).toEqual(ED.verdictLines); await expect(page.getByTestId("map-flag")).toHaveText(ED.splits.map(() => "Audience split")); }
    for (const r of await page.getByTestId("comp-row").all()) {
      const t = (await r.getAttribute("data-title"))!;
      if (ED?.rows[t]?.director) await expect(r.getByTestId("director")).toHaveText(ED.rows[t].director!);
    }
    await assertNoScroll(page);
    await assertRenames(page);
    await page.screenshot({ path: path.join(QA, "design2-results-dreamhackers.png") });
    await page.screenshot({ path: path.join(QA, "08-dreamhackers.png"), fullPage: true });
  });

  test("h. audience check incomplete: Winchester had no estimate (mocked stream of a cached run), then Run again", async ({ browser }) => {
    const inc = path.join(QA, "fixture-incomplete.json"), full = path.join(QA, "fixture-complete.json");
    test.skip(!(await fs.stat(inc).catch(() => null)), "run qa/incomplete-fixture.test.ts first (writes gitignored fixtures from cached Pennywell)");
    const part = JSON.parse(await fs.readFile(inc, "utf8")), whole = JSON.parse(await fs.readFile(full, "utf8"));
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let next = part;
    await page.route(/\/api\/check/, (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: [{ type: "start", at: new Date().toISOString(), comps: 6 }, { type: "result", result: next }].map((e) => JSON.stringify(e)).join("\n") + "\n" }));
    await page.goto("/");
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    const v = page.getByTestId("verdict-line");
    await expect(v.nth(1)).toHaveText("Audience check incomplete: 1 of 6 comps had no estimate; the deck average uses the other 5 (Qloo's estimate).");
    await expect(v.nth(1)).not.toContainText("no comp clearly stands apart");
    await expect(v.nth(1)).not.toContainText("No audience outlier");
    await expect(page.getByTestId("map-point")).toHaveCount(5);
    await expect(page.locator('[data-testid="map-point"][data-title="Winchester"]')).toHaveCount(0);
    await expect(page.getByTestId("map-not-plotted")).toHaveText("Not plotted: Winchester (no estimate)");
    await expect(row(page, "Winchester").locator(".flag.unavail")).toHaveText("Audience estimate unavailable");
    expect(await row(page, "Winchester").getAttribute("data-accent")).toBeNull(); // not an outlier, no accent
    await assertMap(page, []);
    await assertNoScroll(page);
    await page.screenshot({ path: path.join(QA, "design2-incomplete.png") });
    await openExport(page);
    for (const label of ["Export Markdown", "Export CSV"]) {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
      const body = await fs.readFile((await dl.path())!, "utf8");
      expect(body).toMatch(label.includes("CSV") ? /"Winchester \(2018\)[^\n]*"unavailable","unavailable","unavailable"/ : /\| Winchester \| unavailable \| unavailable \|/);
      if (!label.includes("CSV")) expect(body).toMatch(/This deck leans (young|older) overall \(based on 5 of 6 comps\)\./);
    }
    // Run again (mocked: no live Qloo call) with a complete result: fit scores compared, audience not comparable.
    next = whole;
    await page.getByRole("button", { name: "Run again" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("repeat-check")).toHaveText("Run again: fit scores match the previous run to 6 decimals; audience not comparable (audience check incomplete).");
    await page.close();
  });
});

async function assertLabeled(page: Page) {
  const items = page.locator('[data-testid="badge"], [data-testid="flag"]');
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const el = items.nth(i);
    await expect(el).toBeVisible();
    expect((await el.innerText()).trim()).toMatch(/[A-Za-z]{3,}/); // a word, not color or an icon alone
    await expect(el.locator(".icon")).toHaveCount(1);
  }
}

/** Machado et al. 2009 deuteranopia matrix, severity 1.0, applied to the whole page. */
async function simulateDeuteranopia(page: Page) {
  await page.evaluate(() => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("id", "deut-svg"); svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.innerHTML = '<filter id="deut" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0"/></filter>';
    document.body.appendChild(svg);
    document.documentElement.style.filter = "url(#deut)";
  });
}

const comp = (i: number, title: string, extra: Record<string, unknown>) => ({ key: `c${i}`, considerCutting: false, leastViewed: false, reasons: ["Invented test row."], match: { input: { title, year: 2000 + i }, badge: "Matched", matchedTitle: title, matchedYear: 2000 + i, reason: "" }, ...extra });
const MOCK = {
  qlooCalls: 0, cacheHits: 0, ranAt: "mock", notes: [], provider: "stub", stoppedBy: "finish", tokensUsed: 0,
  steps: [{ n: 1, action: "finish", reason: "Mocked.", outcome: "Done." }],
  comps: [
    comp(1, "Alpha", { fit: { key: "c1", entityId: "x1", status: "Scored", affinity: 0.5 }, considerCutting: true, cutLabel: "Consider cutting", rank: { rank: 1, of: 1 }, skewFlag: { dFemale: 0.4, dAge: 0, label: "Qloo's estimate" } }),
    comp(2, "Bravo", { match: { input: { title: "Bravo", year: 2002 }, badge: "Unmatched", reason: "No record." }, agentStatus: "dropped" }),
    comp(3, "Charlie", { fit: { key: "c3", entityId: "x3", status: "Unscored", error: "HTTP 400" }, agentStatus: "set_aside" }),
    comp(4, "Delta", { match: { input: { title: "Delta", year: 2004 }, badge: "Matched", matchedTitle: "Delta", matchedYear: 2004, reason: "", warning: "Thin record." }, fit: { key: "c4", entityId: "x4", status: "Not run" }, agentStatus: "set_aside" }),
  ],
};
