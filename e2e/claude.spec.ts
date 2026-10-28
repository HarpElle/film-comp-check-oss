import { test, expect } from "@playwright/test";
import { assertMap, assertNoScroll, assertNoteMarkers, assertRenames, detail, openExport, openSteps, row, waitIdle } from "./helpers";
import { promises as fs } from "node:fs";
import path from "node:path";
import { EXPECTED } from "./expected";

/**
 * Optional: one Pennywell run against a server started with AGENT_PROVIDER=claude (cached Qloo).
 * Skipped unless QA_CLAUDE_URL is set, so `npm run qa` never spends on the model.
 */
const URL = process.env.QA_CLAUDE_URL;
const QA = path.join(__dirname, "..", "qa");

test.skip(!URL, "QA_CLAUDE_URL not set");

test("h. Claude picks steps after the core; a pick changes the screen; nothing rejected is shown", async ({ page }) => {
  await page.goto(URL!);
  // Design brief: the landing before any click, at 1280x800 and as a full-page scroll.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: path.join(QA, "brief-01-landing.png") });
  await page.screenshot({ path: path.join(QA, "brief-01-landing-full.png"), fullPage: true });
  // Record, in the page, when the table first appears, when each tag note lands and when the run ends.
  await page.evaluate(() => {
    const w = window as unknown as { __qa: Record<string, unknown> & { notes: number[] } };
    w.__qa = { notes: [] };
    const btn = [...document.querySelectorAll("button")].find((x) => x.textContent === "Try the Pennywell sample")!;
    btn.addEventListener("click", () => { w.__qa.click = performance.now(); }, { capture: true, once: true });
    new MutationObserver(() => {
      const busy = !!document.querySelector('[data-testid="live"]');
      if (!w.__qa.table && document.querySelector('[data-testid="comp-row"]')) { w.__qa.table = performance.now(); w.__qa.tableWhileBusy = busy; w.__qa.notesAtTable = document.querySelectorAll('[data-testid="tag-note"]').length; w.__qa.verdictAtTable = [...document.querySelectorAll('[data-testid="verdict-line"]')].map((e) => e.textContent); w.__qa.exportDisabledAtTable = [...document.querySelectorAll("button")].filter((x) => /^Export/.test(x.textContent ?? "")).every((x) => (x as HTMLButtonElement).disabled); }
      const n = document.querySelectorAll('[data-testid="tag-note"]').length;
      while (w.__qa.notes.length < n) { w.__qa.notes.push(performance.now()); if (document.querySelector('[data-testid="choosing"]')) w.__qa.choosingWithNote = true; }
      if (w.__qa.table && busy && document.querySelector('[data-testid="choosing"]') && !w.__qa.choosing) {
        w.__qa.choosing = performance.now(); w.__qa.choosingWithTable = true;
        // Mid-run layout at 1280x800: verdict area, every row and the one-line live status, without scrolling.
        const bottom = (el: Element | null) => (el ? el.getBoundingClientRect().bottom + window.scrollY : Infinity);
        const rows = [...document.querySelectorAll('[data-testid="comp-row"]')];
        const ls = document.querySelector('[data-testid="live-status"]');
        w.__qa.mid = { verdict: bottom(document.querySelector('[data-testid="verdict"]')), rows: rows.length, rowsBottom: Math.max(...rows.map(bottom)), live: bottom(ls), liveText: ls?.textContent ?? "", liveH: ls ? ls.getBoundingClientRect().height : 0 };
      }
      if (w.__qa.choosing && !w.__qa.choosingGone && !document.querySelector('[data-testid="choosing"]')) w.__qa.choosingGone = performance.now();
      if (/no model response/.test(document.body.innerText)) w.__qa.interim = true;
      if (w.__qa.table && !busy && !w.__qa.done) w.__qa.done = performance.now();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const respP = page.waitForResponse(/\/api\/check/, { timeout: 120_000 });
  await page.getByRole("button", { name: "Try the Pennywell sample" }).click(); // one click: load + run
  await openSteps(page, 120_000);
  await expect(page.getByTestId("steps")).toBeVisible({ timeout: 120_000 });
  await waitIdle(page);
  const qa = await page.evaluate(() => (window as unknown as { __qa: { choosing?: number; choosingGone?: number; interim?: boolean; click: number; table: number; tableWhileBusy: boolean; notesAtTable: number; verdictAtTable: string[]; exportDisabledAtTable: boolean; notes: number[]; done: number } }).__qa);
  const rel = (t: number) => Math.round(t - qa.click);
  expect(qa.choosing).toBeGreaterThanOrEqual(qa.table); // "Agent is choosing next steps" shows after core_result
  expect(qa.choosingGone).toBeGreaterThan(qa.choosing!); // and is cleared once a chosen step lands
  expect((qa as { choosingWithNote?: boolean }).choosingWithNote).toBeUndefined(); // the status line was gone whenever a note landed
  await expect(page.getByTestId("choosing")).toHaveCount(0); // gone at final
  const mid = (qa as unknown as { mid: { verdict: number; rows: number; rowsBottom: number; live: number; liveText: string; liveH: number } }).mid;
  expect(mid.rows).toBe(6);
  expect(mid.verdict).toBeLessThanOrEqual(800);
  expect(mid.rowsBottom).toBeLessThanOrEqual(800);
  expect(mid.live).toBeLessThanOrEqual(800);
  expect(mid.liveText).toContain("Agent is choosing next steps");
  expect(mid.liveH).toBeLessThan(24); // one line
  await expect(page.getByTestId("live-status")).toHaveCount(0); // gone at final
  expect(qa.interim).toBeUndefined(); // the interim label never rendered
  await expect(page.getByTestId("provider")).toHaveText("(Claude Sonnet 5.5)");
  expect(qa.tableWhileBusy).toBe(true); // the core result rendered while chosen steps were still running
  expect(qa.notesAtTable).toBe(0);
  expect(qa.exportDisabledAtTable).toBe(true);
  expect(qa.notes.length).toBeGreaterThan(0);
  for (const t of qa.notes) expect(t).toBeGreaterThan(qa.table);
  await expect(page.getByTestId("verdict-line")).toHaveText(qa.verdictAtTable); // verdict never changes after core_result
  await expect(page.getByTestId("note-marker").first()).toContainText("Model chose \u00b7 step");
  // Claude's verdict equals the stub's on the same cached deck (expected from the local cache when present).
  await expect(page.getByTestId("verdict-line")).toHaveCount(3, { timeout: 120_000 });
  await expect(page.getByTestId("verdict-line").first()).toHaveText("6 of 6 comps matched.");
  if (EXPECTED) await expect(page.getByTestId("verdict-line")).toHaveText(EXPECTED.pennywell.verdictLines);
  await expect(page.getByTestId("provider")).toHaveText("(Claude Sonnet 5.5)");
  const scores: Record<string, string> = {};
  for (const r of await page.getByTestId("comp-row").all()) scores[(await r.getAttribute("data-title"))!] = (await r.getByTestId("score").getAttribute("data-score"))!;
  for (const v of Object.values(scores)) expect(v).toMatch(/^0\.\d{6}$/);
  if (EXPECTED) expect(scores).toEqual(EXPECTED.pennywell.scores6); // same scores as the stub, every run
  const tags = new Set(await page.locator('[data-testid="steps"] li[data-n] > [data-testid="origin"], [data-testid="steps"] li[data-n] > details > summary > [data-testid="origin"]').allInnerTexts());
  expect([...tags].every((t) => t === "Always runs" || t === "Model chose" || t === "Template")).toBe(true);
  expect(tags.has("Model chose")).toBe(true);
  await expect(page.locator('[data-testid="steps"] li', { hasText: /Rejected|Refused/ })).toHaveCount(0);
  const chosen = page.locator('[data-testid="steps"] li[data-origin="model"]');
  expect(await chosen.count()).toBeGreaterThan(0);
  for (const c of await chosen.all()) await expect(c.getByTestId("basis-value")).toHaveText(/^\d[\d,]*(\.\d{3})?$/);
  await assertMap(page, EXPECTED?.pennywell.outliers);
  await assertNoScroll(page);
  await assertRenames(page);
  // Design brief: results after the Claude run finished (details closed), at 1280x800 and full page.
  await page.screenshot({ path: path.join(QA, "brief-02-results.png") });
  await page.screenshot({ path: path.join(QA, "brief-02-results-full.png"), fullPage: true });
  // A screen-changing pick: a guarded Qloo tag note in a Why line (the stub never shows one). Notes sit in the comp detail.
  const noted = await page.locator('[data-testid="comp-detail"]:has([data-testid="tag-note"])').evaluateAll((els) => els.map((e) => e.getAttribute("data-title")!));
  expect(noted.length).toBeGreaterThan(0);
  const outT = (await page.locator('[data-testid="comp-row"]:has(.flag.skew, .flag.split)').first().getAttribute("data-title"))!;
  const lowT = (await page.locator('[data-testid="comp-row"]:has(.flag.cut, .flag.close)').first().getAttribute("data-title"))!;
  for (const t of new Set([...noted, outT, lowT])) await row(page, t).getByTestId("comp-toggle").click();
  await expect(page.getByTestId("tag-note").first()).toBeVisible();
  await assertNoteMarkers(page);
  const notes = await page.getByTestId("tag-note").allInnerTexts();
  const steps = await page.locator('[data-testid="steps"] li[data-n]').allInnerTexts();
  const why = { [outT]: await detail(page, outT).getByTestId("why").innerText(), [lowT]: await detail(page, lowT).getByTestId("why").innerText() };
  const timing = { choosingMs: rel(qa.choosing!), choosingGoneMs: rel(qa.choosingGone!), coreResultMs: rel(qa.table), noteMs: qa.notes.map(rel), totalMs: rel(qa.done) };
  const final = (await (await respP).text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "result");
  const stats = final?.result?.agentStats;
  await fs.writeFile(path.join(QA, `claude-ui-run${process.env.QA_TAG ?? ""}.json`), JSON.stringify({ timing, steps, notes, why, scores, stats }, null, 1));
  await page.screenshot({ path: path.join(QA, process.env.QA_SHOT ?? "10-claude-pennywell.png"), fullPage: true });

  // Design brief: the exported sheet.
  await openExport(page);
  for (const [label, file] of [["Export Markdown", "brief-03-export.md"], ["Export CSV", "brief-03-export.csv"]] as const) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
    await dl.saveAs(path.join(QA, file));
  }
  // There is no export preview in the app, so the .md is rendered to HTML here, only for this screenshot.
  const md = await fs.readFile(path.join(QA, "brief-03-export.md"), "utf8");
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 1280, height: 800 });
  await sheet.setContent(mdToHtml(md));
  await sheet.screenshot({ path: path.join(QA, "brief-03-export.png") });
  await sheet.screenshot({ path: path.join(QA, "brief-03-export-full.png"), fullPage: true });
  await sheet.close();
});

/** Minimal Markdown to HTML for the export sheet screenshot only: headings, lists, pipe tables, paragraphs. */
function mdToHtml(md: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => esc(c.trim().replace(/\\\|/g, "|")));
  const out: string[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#+ /.test(l)) { const n = l.match(/^#+/)![0].length; out.push(`<h${n}>${esc(l.slice(n + 1))}</h${n}>`); }
    else if (/^\|/.test(l)) {
      const head = cells(l); i++; // skip the |---| row
      const body: string[][] = [];
      while (i + 1 < lines.length && /^\|/.test(lines[i + 1])) body.push(cells(lines[++i]));
      out.push(`<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    } else if (/^- /.test(l)) { const items = [l]; while (/^- /.test(lines[i + 1] ?? "")) items.push(lines[++i]); out.push(`<ul>${items.map((x) => `<li>${esc(x.slice(2))}</li>`).join("")}</ul>`); }
    else if (/^\d+\. /.test(l)) { const items = [l]; while (/^\d+\. /.test(lines[i + 1] ?? "")) items.push(lines[++i]); out.push(`<ol>${items.map((x) => `<li>${esc(x.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`); }
    else if (l.trim()) out.push(`<p>${esc(l)}</p>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>comp-check.md</title><style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eee}</style></head><body>${out.join("\n")}</body></html>`;
}
