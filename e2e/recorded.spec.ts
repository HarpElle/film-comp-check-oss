/**
 * Recorded mode, through the store. Started by e2e/run-recorded.sh against production servers that share a
 * seeded STORE_FILE_DIR (recorded samples from the local Qloo cache, or synthetic ones in CI), with no Qloo
 * key and an empty Qloo cache, so no Qloo request can leave:
 *   QA_RECORDED_URL  QLOO_LIVE=0, stub provider        (recorded samples, paused custom form)
 *   QA_LIMIT_URL     live mode, IP_DAILY_LIVE_CHECKS=0  (visitor limit)
 *   QA_REPLAY_URL    Claude configured with no key      (replay backup; skipped when no replay is seeded)
 *   QA_VERCEL_URL    VERCEL=1 with no model key         (never the stub: replay, or the plain agent error)
 * Expected verdicts are read from the store (the landing snippet), never written here.
 */
import { test, expect, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertMap, assertNoScroll, openExport, waitIdle } from "./helpers";

const REC = process.env.QA_RECORDED_URL, LIMIT = process.env.QA_LIMIT_URL, REPLAY = process.env.QA_REPLAY_URL, VERCEL = process.env.QA_VERCEL_URL;
const AGENT_UNAVAILABLE = "The agent couldn't start. Nothing was scored by a model. Try again in a minute.";
const QA = path.join(__dirname, "..", "qa");
const RECORDED = /^Qloo results recorded [A-Z][a-z]{2} \d{1,2}, \d{4} · Fixed rules chose (\d+) of (\d+) steps live\.$/;
const REPLAYED = /^(?:Replay of a recorded run · Claude chose (\d+) of (\d+) steps)\.$/;
const VISITOR_LIMIT = "You've used today's live checks. The sample decks still run.";
const CUSTOM = "Alpha Film | 2001\nBeta Film | 2002\nGamma Film | 2003";

async function stamp(page: Page) { return (await page.getByTestId("recorded-stamp").innerText()).trim(); }

test.describe("recorded mode (no Qloo key, empty Qloo cache)", () => {
  test.skip(!REC, "QA_RECORDED_URL not set (run e2e/run-recorded.sh)");
  test("Pennywell sample runs from the recording: status line, rule-chosen markers, no live calls, stamp in export and print", async ({ page }) => {
    await page.goto(REC!);
    await expect(page.getByTestId("sample-verdict")).toBeVisible(); // from the store; none without one
    const landing = await page.getByTestId("sample-verdict-line").allInnerTexts();
    expect(landing.length).toBe(3);
    await expect(page.getByTestId("landing-sample-label")).not.toContainText("paused for today"); // judge mode
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(6);
    expect(await page.getByTestId("verdict-line").allInnerTexts()).toEqual(landing);
    const s = await stamp(page);
    const m = s.match(RECORDED);
    expect(m, s).not.toBeNull();
    const chose = await page.getByTestId("steps").getByTestId("origin").filter({ hasText: "Rule chose" }).count();
    expect(chose).toBeGreaterThan(0);
    expect(Number(m![1])).toBe(chose);
    expect(Number(m![2])).toBe(await page.getByTestId("steps").locator("li[data-n]").count());
    // A recorded (or 30-day reused) result says so where the Live calls line would go.
    await expect(page.getByTestId("calls")).toHaveText("No new Qloo calls.");
    await expect(page.getByTestId("sample-label")).not.toContainText("paused");
    await expect(page.getByTestId("sample-label")).toHaveText(/^Sample run, recorded [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    // Judge mode (live checks off) on a sample run: no "paused for today" line, on the landing or the result.
    await expect(page.getByTestId("paused-live")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("paused for today");
    await expect(page.locator("body")).not.toContainText(/Live: \d+ Qloo call/);
    await expect(page.locator("body")).not.toContainText("Run again calls Qloo live");
    // SAMPLE_LIVE unset (the default): no "Run live on Qloo" and no quiet line, only "Run again", as on a removed deck.
    await expect(page.getByTestId("sample-quiet-line")).toHaveCount(0);
    await expect(page.getByTestId("run-live-qloo")).toHaveCount(0);
    await expect(page.getByTestId("calls").locator("xpath=..")).not.toContainText("Recorded run.");
    await expect(page.getByTestId("replay-again")).toHaveText("Run again");
    await assertMap(page);
    await assertNoScroll(page);
    await page.screenshot({ path: path.join(QA, "design2-recorded-pennywell.png") });
    await openExport(page);
    for (const label of ["Export Markdown", "Export CSV"]) {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
      expect(await fs.readFile((await dl.path())!, "utf8")).toContain(`${s}`);
    }
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("print-head")).toContainText(s);
    await page.emulateMedia({ media: "screen" });
    // The API says the same: recorded, zero Qloo calls, and no live event in the stream.
    const comps = (await (await page.request.get(`${REC}/api/status`)).json()).samples.find((x: { id: string }) => x.id === "pennywell").comps;
    const body = await (await page.request.post(`${REC}/api/check?stream=1`, { data: { comps } })).text();
    const ev = body.trim().split("\n").map((l) => JSON.parse(l));
    expect(ev.some((e) => e.type === "qloo_live")).toBe(false);
    const res = ev.find((e) => e.type === "result").result;
    expect(res.qlooCalls).toBe(0);
    expect(res.recorded).toBeTruthy();
  });

  test("custom-deck form says live checks are paused before anyone types", async ({ page }) => {
    await page.goto(REC!);
    await expect(page.getByTestId("paused-note")).toContainText("Live Qloo checks are paused.");
    await expect(page.getByRole("button", { name: "Check comps" })).toBeEnabled(); // the box holds the sample
    await page.locator("#comps").fill(CUSTOM);
    await expect(page.getByRole("button", { name: "Check comps" })).toBeDisabled();
    await page.getByTestId("deck-input").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(QA, "design2-paused-form.png") });
    const ev = (await (await page.request.post(`${REC}/api/check?stream=1`, { data: { comps: [{ title: "Alpha Film", year: 2001 }, { title: "Beta Film", year: 2002 }, { title: "Gamma Film", year: 2003 }] } })).text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(ev.at(-1).type).toBe("error");
    expect(ev.at(-1).error).toContain("Live Qloo checks are paused");
  });
});

test.describe("fewer than 3 matched, and cards at 375px", () => {
  test.skip(!REC, "QA_RECORDED_URL not set (run e2e/run-recorded.sh)");
  test("fit never ran: no fit score, rank, fit-derived flag, audience flag, map, or fit-quoting step", async ({ page }) => {
    // The real recorded result, with all but two comps turned Unmatched (fit-derived fields left in on purpose: the page must hide them).
    await page.route("**/api/check**", async (route) => {
      const res = await route.fetch();
      const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
      for (const ev of lines) for (const k of ["result", "partial"]) if (ev[k]?.comps) ev[k].comps.forEach((c: { match: { badge: string } }, i: number) => { if (i >= 2) c.match.badge = "Unmatched"; });
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
    });
    await page.goto(REC!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("verdict-too-few")).toBeVisible();
    await expect(page.getByTestId("too-few")).toContainText("Only 2 comps matched");
    for (const t of ["Lowest fit, close call", "Consider cutting", "Also least viewed", "Audience split", "Audience outlier"]) await expect(page.getByTestId("results"), t).not.toContainText(t);
    await expect(page.locator(".fit-score")).toHaveCount(0);
    for (const r of await page.getByTestId("rank").allInnerTexts()) expect(r.trim()).toBe("");
    await expect(page.locator("figure.deckmap")).toHaveCount(0);
    const steps = (await page.getByTestId("steps").innerText().catch(() => ""));
    expect(steps).not.toMatch(/\bfit\b|affinity|close call|least viewed|outlier|audience split|\b0\.\d{3}/i);
  });
  test("375px: each comp is a card with its fit score, rank and flags; no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(REC!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(6);
    await expect(page.locator("table.results thead").first()).toBeHidden();
    const row = page.getByTestId("comp-row").first();
    expect(await row.evaluate((e) => getComputedStyle(e).display)).toBe("flex");
    // Cells stack inside the card: fit score sits below the comp title, rank below the fit score (no overlap).
    const [tb, sb, rb] = [await row.getByTestId("comp-toggle").boundingBox(), await row.getByTestId("score").boundingBox(), await row.getByTestId("rank").boundingBox()];
    expect(sb!.y).toBeGreaterThanOrEqual(tb!.y + tb!.height);
    // Flags directly under the title, above the Qloo match and fit score (find a row that has a flag).
    const flagged = page.getByTestId("comp-row").filter({ has: page.locator(".flag") }).first();
    const [ft, ff, fm] = [await flagged.getByTestId("comp-toggle").boundingBox(), await flagged.locator(".flags-cell").boundingBox(), await flagged.locator(".match-cell").boundingBox()];
    expect(ff!.y).toBeGreaterThanOrEqual(ft!.y + ft!.height - 1);
    expect(ff!.y + ff!.height).toBeLessThanOrEqual(fm!.y + 1);
    expect(rb!.y).toBeGreaterThanOrEqual(sb!.y + sb!.height - 1);
    await expect(row.getByTestId("score")).toBeVisible();
    await expect(row.getByTestId("rank")).toBeVisible();
    expect(await row.getByTestId("score").evaluate((e) => getComputedStyle(e, "::before").content)).toBe('"Fit score"');
    const box = (await row.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(await page.getByTestId("table-scroll").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await expect(page.getByTestId("comp-detail").first()).toBeHidden(); // closed details stay closed as cards
    await row.getByTestId("comp-toggle").click();
    await expect(page.getByTestId("comp-detail").first()).toBeVisible();
  });
});

test.describe("visitor limit", () => {
  test.skip(!LIMIT, "QA_LIMIT_URL not set");
  test("over today's live checks: our message with the sample buttons; the samples still run", async ({ page }) => {
    await page.goto(LIMIT!);
    await expect(page.getByTestId("sample-verdict")).toBeVisible(); // status loaded
    await expect(page.getByTestId("paused-note")).toHaveCount(0); // live mode
    await page.locator("#comps").fill(CUSTOM);
    await page.getByRole("button", { name: "Check comps" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("error-detail")).toHaveText(VISITOR_LIMIT);
    await expect(page.getByTestId("error-sample")).toBeVisible();
    await expect(page.getByTestId("error-sample-dreamhackers")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.getByTestId("verdict")).toHaveCount(0);
    await page.screenshot({ path: path.join(QA, "design2-visitor-limit.png") });
    await page.getByTestId("error-sample").click();
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(6);
    expect(await stamp(page)).toMatch(RECORDED);
  });
});

test.describe("replay backup", () => {
  test.skip(!REPLAY, "QA_REPLAY_URL not set (no replay seeded)");
  test("Claude unavailable: the recorded Claude run replays, stamped as a replay", async ({ page }) => {
    await page.goto(REPLAY!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(6);
    const s = await stamp(page);
    const m = s.match(REPLAYED);
    expect(m, s).not.toBeNull();
    await expect(page.getByTestId("replay-tag")).toHaveText("Replay");
    expect(Number(m![1])).toBe(await page.getByTestId("steps").getByTestId("origin").filter({ hasText: "Model chose" }).count());
    expect(Number(m![2])).toBe(await page.getByTestId("steps").locator("li[data-n]").count());
  });
});

test.describe("on Vercel (VERCEL=1), never the stub", () => {
  test.skip(!VERCEL, "QA_VERCEL_URL not set");
  test("no 'Stub' on any screen: status line, Agent steps, export, print; a removal with no model key is re-scored from the recording with Template steps", async ({ page }) => {
    await page.goto(VERCEL!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    const noStub = async () => { expect(await page.locator("body").innerText()).not.toMatch(/\bStub\b/); };
    if (REPLAY) {
      await expect(page.getByTestId("comp-row")).toHaveCount(6);
      expect(await stamp(page)).toMatch(REPLAYED);
      await noStub();
      await openExport(page);
      for (const label of ["Export Markdown", "Export CSV"]) {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
        expect(await fs.readFile((await dl.path())!, "utf8")).not.toMatch(/\bStub\b/);
      }
      await page.emulateMedia({ media: "print" });
      await noStub();
      await page.emulateMedia({ media: "screen" });
      await expect(page.getByTestId("replay-again").or(page.getByTestId("sample-quiet-line"))).toHaveCount(1);
      // Judge mode: a removal is re-scored from the recording (every 5-comp subset is recorded) with Template
      // steps, never the stub and never a model claim.
      await page.getByRole("button", { name: "Remove Midsommar" }).click();
      await waitIdle(page);
      await expect(page.getByTestId("comp-row")).toHaveCount(5);
      expect(await stamp(page)).toMatch(/Claude didn't run; Template steps \d+ of \d+/);
      await noStub();
      return;
    }
    await expect(page.getByTestId("error-detail")).toHaveText(AGENT_UNAVAILABLE);
    await noStub();
  });
});

test.describe("the word Stub never reaches a judge (stub provider running)", () => {
  test.skip(!REC, "QA_RECORDED_URL not set (run e2e/run-recorded.sh)");
  const scan = async (page: import("@playwright/test").Page, where: string) => {
    expect(await page.locator("body").innerText(), `${where}: body text`).not.toMatch(/stub/i);
    const attrs = await page.evaluate(() => [...document.querySelectorAll("*")].flatMap((el) => ["title", "aria-label", "alt", "placeholder", "data-label"].map((a) => el.getAttribute(a) ?? "")).join(" "));
    expect(attrs, `${where}: title/aria/alt attributes`).not.toMatch(/stub/i);
    expect(await page.title(), `${where}: page title`).not.toMatch(/stub/i);
  };
  const exportsClean = async (page: import("@playwright/test").Page) => {
    await openExport(page);
    for (const label of ["Export Markdown", "Export CSV"]) {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
      expect(await fs.readFile((await dl.path())!, "utf8"), label).not.toMatch(/stub/i);
    }
  };
  for (const sample of ["Pennywell", "Dream Hackers"]) {
    test(`${sample} sample: no "Stub" on screen, folded steps, print, or exports`, async ({ page }) => {
      await page.goto(REC!);
      await scan(page, "landing");
      await page.getByRole("button", { name: `Try the ${sample} sample` }).click();
      await waitIdle(page);
      await expect(page.getByTestId("provider")).not.toContainText(/stub/i);
      for (const d of await page.locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await scan(page, `${sample} results`);
      await page.emulateMedia({ media: "print" });
      await scan(page, `${sample} print`);
      await page.emulateMedia({ media: "screen" });
      await exportsClean(page);
    });
  }
  test("fewer than 3 matched: stamp names no steps; no Stub anywhere", async ({ page }) => {
    await page.route("**/api/check**", async (route) => {
      const res = await route.fetch();
      const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
      for (const ev of lines) for (const k of ["result", "partial"]) if (ev[k]?.comps) ev[k].comps.forEach((c: { match: { badge: string } }, i: number) => { if (i >= 2) c.match.badge = "Unmatched"; });
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
    });
    await page.goto(REC!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("verdict-too-few")).toBeVisible();
    expect(await stamp(page)).toMatch(/^Qloo results recorded [A-Z][a-z]{2} \d{1,2}, \d{4}\.?$/);
    await expect(page.getByTestId("print-head")).not.toContainText(/steps/);
    for (const d of await page.locator("details").all()) await d.evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await scan(page, "fewer than 3");
    await exportsClean(page);
  });
});

test.describe("two-date stamp", () => {
  test.skip(!REC, "QA_RECORDED_URL not set (run e2e/run-recorded.sh)");
  test("replay on a later day than the Qloo record: two-date label above the verdict, in print and in exports", async ({ page }) => {
    await page.route("**/api/check**", async (route) => {
      const res = await route.fetch();
      const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
      for (const ev of lines) for (const k of ["result", "partial"]) if (ev[k]?.recorded) ev[k].recorded = { ...ev[k].recorded, at: "2026-10-19T21:12:49.012Z", replay: { model: "m", at: "2026-10-27T15:00:00.000Z" } };
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
    });
    const LINE = "Sample run. Qloo data recorded Oct 19, 2026, agent steps replayed Oct 27, 2026";
    await page.goto(REC!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("sample-label")).toHaveText(LINE + "."); // exact
    // Directly above the verdict box, in small type.
    const [lb, vb] = [await page.getByTestId("sample-label").boundingBox(), await page.getByTestId("verdict").boundingBox()];
    expect(vb!.y - (lb!.y + lb!.height)).toBeLessThan(24);
    expect(await page.getByTestId("sample-label").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(14);
    await expect(page.getByTestId("print-head")).toContainText(LINE);
    await openExport(page);
    for (const label of ["Export Markdown", "Export CSV"]) {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
      expect(await fs.readFile((await dl.path())!, "utf8"), label).toContain(LINE);
    }
  });
});

/** Objective fixes from the design critique (design-critique/critique-375px.md and critique-1280px.md). Wording is untouched. */
test.describe("design critique fixes", () => {
  test.skip(!REC, "QA_RECORDED_URL not set (run e2e/run-recorded.sh)");
  const tooFewRoute = async (page: Page) => page.route("**/api/check**", async (route) => {
    const res = await route.fetch();
    const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const ev of lines) for (const k of ["result", "partial"]) if (ev[k]?.comps) ev[k].comps.forEach((c: { match: { badge: string } }, i: number) => { if (i >= 2) c.match.badge = "Unmatched"; });
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
  });

  test("1280: Export menu closes on Escape and outside click; verdict is an h1 and gets focus; table semantics; contrast tokens", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(REC!);
    // Landing: field hint is announced; textarea resizes vertically only; verdict lines carry their icons.
    expect((await page.locator("#comps").getAttribute("aria-describedby"))!.split(" ")).toContain("comps-hint");
    expect(await page.locator("#comps").evaluate((e) => getComputedStyle(e).resize)).toBe("vertical");
    await expect(page.getByTestId("sample-verdict-line").first().locator(".icon")).toHaveCount(1);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    // No visible "Verdict" label; the heading is sr-only and takes focus after the run.
    await expect(page.getByRole("heading", { level: 1, name: "Verdict" })).toHaveClass(/sr-only/);
    await expect(page.getByTestId("verdict-heading")).toBeFocused();
    const menu = page.getByTestId("export-menu");
    await menu.locator("summary").click();
    await expect(menu.getByRole("menu")).toBeVisible();
    // Three export items (WP-J) plus Copy share link.
    await expect(menu.getByRole("menuitem")).toHaveText([/Export sheet/, "Export Markdown", "Export CSV", /Copy share link/]);
    await page.keyboard.press("Escape");
    expect(await menu.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await menu.locator("summary").click();
    await page.mouse.click(640, 700);
    expect(await menu.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await expect(page.locator("table.results caption")).toHaveCount(1);
    for (const s of await page.locator("table.results thead th").evaluateAll((ths) => ths.map((t) => t.getAttribute("scope")))) expect(s).toBe("col");
    // Muted text #6a6a6a (AA on white and on the #f2f2f2 row tint); control borders #949494 (3:1).
    expect(await page.getByTestId("legend").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(106, 106, 106)");
    expect(await page.getByTestId("appbar").getByRole("button", { name: "Edit comps" }).evaluate((e) => getComputedStyle(e).borderTopColor)).toBe("rgb(148, 148, 148)");
    // Appbar buttons share one height.
    const [eb, xb] = [await page.getByTestId("appbar").getByRole("button", { name: "Edit comps" }).boundingBox(), await menu.locator("summary").boundingBox()];
    expect(Math.abs(eb!.height - xb!.height)).toBeLessThanOrEqual(1);
    // Bar values never wrap ("+0.123 outlier" stays on one line).
    for (const r of await page.getByTestId("comp-row").all()) await r.getByTestId("comp-toggle").click();
    for (const v of await page.getByTestId("bar-value").all()) expect((await v.boundingBox())!.height).toBeLessThan(26);
    // Outlier and split markers do not shift the comp column: every title starts at the same x.
    const xs = new Set(await page.getByTestId("comp-toggle").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x))));
    expect(xs.size).toBe(1);
  });

  test("375: tap targets are at least 44px; outlier/split cards keep a marker; an open detail stays attached to its card", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(REC!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    const min44 = async (l: ReturnType<Page["locator"]>, what: string) => { const b = (await l.boundingBox())!; expect(b.height, what).toBeGreaterThanOrEqual(44); expect(b.width, what).toBeGreaterThanOrEqual(44); };
    await min44(page.getByTestId("comp-row").first().locator(".rm"), "remove");
    await min44(page.getByTestId("appbar").getByRole("button", { name: "Edit comps" }), "edit");
    await min44(page.getByTestId("export-menu").locator("summary"), "export");
    expect((await page.getByTestId("comp-toggle").first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("export-menu").locator("summary").click();
    for (const b of await page.getByRole("menuitem").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    const accent = page.locator("tr.comp.accent").first();
    if (await accent.count()) expect(await accent.evaluate((e) => getComputedStyle(e).boxShadow)).toContain("inset");
    const split = page.locator("tr.comp.split").first();
    if (await split.count()) expect(await split.evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("dashed");
    const row = page.getByTestId("comp-row").first();
    await row.getByTestId("comp-toggle").click();
    const [rb, db] = [(await row.boundingBox())!, (await page.getByTestId("comp-detail").first().boundingBox())!];
    expect(Math.abs(db.y - (rb.y + rb.height))).toBeLessThanOrEqual(1);
    expect(await page.getByTestId("comp-detail").first().locator("td").evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("solid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test("fewer than 3: alert icon, single column, no Rank column or fit legend, chose-count matches the listed steps", async ({ page }) => {
    await tooFewRoute(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(REC!);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await expect(page.getByTestId("verdict-too-few").getByTestId("verdict-line").locator(".icon")).toHaveAttribute("data-icon", "alert");
    await expect(page.getByTestId("top")).toHaveClass(/\bsingle\b/);
    await expect(page.locator("table.results thead th", { hasText: /^Rank$/ })).toHaveCount(0);
    await expect(page.getByTestId("rank")).toHaveCount(0);
    await expect(page.getByTestId("legend")).toHaveCount(0);
    const cc = page.getByTestId("chose-count");
    if (await cc.count()) {
      const m = (await cc.innerText()).match(/(\d+) of (\d+) steps; the other (\d+) always run/)!;
      const chosen = await page.getByTestId("chosen-steps").locator("li[data-n]").count();
      const total = await page.getByTestId("steps").locator("li[data-n]").count();
      expect([Number(m[1]), Number(m[2]), Number(m[3])]).toEqual([chosen, total, total - chosen]);
    }
  });
});
