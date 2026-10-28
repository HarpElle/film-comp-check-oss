/**
 * Design spec: Remove with a change summary and Undo, in judge mode (no keys): the removal is re-scored from
 * the recorded Qloo data, 0 Qloo calls. Expected labels come from the server's own answer for the narrowed deck
 * and from the recording; no Qloo values or step numbers are written here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { removalSummary } from "../lib/change-summary";
import { recordedStamp } from "../lib/stamp";
import type { AgentStep, CheckResult } from "../lib/types";
import { openExport, waitIdle } from "./helpers";
import { FAKE_SCORES } from "../test/fixtures/fake-gaps";

const URL = process.env.QA_HANDOFF_URL;
const STORE = process.env.QA_HANDOFF_STORE;
test.skip(!URL || !STORE, "run through e2e/run-handoff.sh");

const recording = (id: string): CheckResult => {
  const f = join(STORE!, createHash("sha256").update(`sample:replay:${id}`).digest("hex") + ".json");
  return JSON.parse(readFileSync(f, "utf8")).v.result;
};
const REMOVE = "Midsommar";
/** A Claude replay recorded for the deck without REMOVE (scripts/build-claude-replay.ts, REPLAY_WITHOUT), if this store has one. */
const hasSubReplay = () => { try { return !!readFileSync(join(STORE!, createHash("sha256").update(`sample:replay:pennywell:without:${REMOVE.toLowerCase()}`).digest("hex") + ".json"), "utf8"); } catch { return false; } };
const inputs = (r: CheckResult) => r.comps.map((c) => c.match.input);

async function serverResult(page: Page, comps: unknown[]): Promise<CheckResult> {
  const body = await (await page.request.post(`${URL}/api/check?stream=1`, { data: { comps } })).text();
  const ev = body.trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "result");
  expect(ev, body.slice(0, 300)).toBeTruthy();
  return ev.result;
}

async function runPennywell(page: Page) {
  await page.goto(URL! + "/");
  await page.getByRole("button", { name: "Try the Pennywell sample" }).first().click();
  await waitIdle(page);
}

const scores = (page: Page) => page.getByTestId("score").evaluateAll((els) => els.map((e) => `${e.closest("tr")?.getAttribute("data-title")}=${e.getAttribute("data-score")}`));

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test.describe(`Remove and Undo at ${vp.width}`, () => {
    test.use({ viewport: vp });

    test(`removing ${REMOVE}: results stay on screen, the summary names the computed label changes, 0 Qloo calls`, async ({ page }) => {
      const before = recording("pennywell");
      const after = await serverResult(page, inputs(before).filter((c) => c.title !== REMOVE));
      expect(after.qlooCalls).toBe(0);
      await runPennywell(page);
      const before6 = await scores(page);
      // Never blank: from the click to the end of the rerun there is always at least one result row.
      await page.evaluate(() => {
        const w = window as unknown as { __blank: number; __removed: string[] };
        w.__blank = 0; w.__removed = [];
        new MutationObserver(() => {
          if (!document.querySelector("[data-testid=comp-row], [data-testid=removed-row]")) w.__blank++;
          const r = document.querySelector<HTMLElement>("[data-testid=removed-row]");
          if (r) w.__removed.push(`${r.querySelector("s")?.textContent}|${r.textContent}|${r.getBoundingClientRect().height}`);
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      await page.getByRole("button", { name: `Remove ${REMOVE}` }).click();
      await waitIdle(page);
      const seen = await page.evaluate(() => { const w = window as unknown as { __blank: number; __removed: string[] }; return { blank: w.__blank, removed: w.__removed }; });
      expect(seen.blank).toBe(0);
      // While it reran, the removed comp sat in a collapsed row: title struck through, "Removed", 28 px tall.
      expect(seen.removed.length).toBeGreaterThan(0);
      for (const r of seen.removed) { const [s, t, h] = r.split("|"); expect(s).toBe(REMOVE); expect(t).toContain("Removed"); expect(Number(h)).toBeLessThanOrEqual(29); }
      await expect(page.getByTestId("comp-row")).toHaveCount(before.comps.length - 1);
      await expect(page.getByTestId("removed-row")).toHaveCount(0);
      await expect(page.getByTestId("change-summary-text")).toHaveText(removalSummary(REMOVE, before, after));
      // The rows show the server's computed labels (the demo state: the new lowest fit).
      const cut = after.comps.find((c) => c.considerCutting);
      if (cut?.cutLabel) await expect(page.locator(`[data-testid=comp-row][data-title="${cut.match.input.title}"]`)).toContainText(cut.cutLabel);
      await expect(page.getByTestId("calls")).toHaveText("No new Qloo calls.");
      // Removed state: the status line carries no date (the sample label above the verdict already has it).
      await expect(page.getByTestId("recorded-stamp")).not.toHaveText(/\d{4}/);
      // With a Claude replay recorded for this make-up, judge mode serves it instead of Template steps.
      if (hasSubReplay()) {
        expect(after.recorded?.replay).toBeDefined();
        await expect(page.getByTestId("recorded-stamp")).toHaveText(/^Replay of a recorded run · Claude chose \d+ of \d+ steps\.$/);
        await expect(page.locator("body")).not.toContainText("Template steps");
      }
      // Judge mode, sample run: no "paused for today" line anywhere.
      await expect(page.locator("body")).not.toContainText("paused for today");
      await expect(page.locator("body")).not.toContainText(/\bStub\b/);
      // Focus: Remove moves it to Undo.
      const undo = page.getByTestId("undo-remove");
      await expect(undo).toHaveText(`Undo, put ${REMOVE} back`);
      await expect(undo).toBeFocused();
      await undo.click();
      await waitIdle(page);
      await expect(page.getByTestId("comp-row")).toHaveCount(before.comps.length);
      // Restored at its original index, scores identical to 6 decimals, focus on the restored title.
      expect(await page.getByTestId("comp-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-title")))).toEqual(before.comps.map((c) => c.match.input.title));
      expect(await scores(page)).toEqual(before6);
      await expect(page.locator(`[data-testid=comp-row][data-title="${REMOVE}"] [data-testid=comp-toggle]`)).toBeFocused();
      await expect(page.getByTestId("undo-remove")).toHaveCount(0);
    });
  });
}

/** Steps the agent chose (the count the stamp quotes), and every step, as "N of M". */
const choseOf = (steps: AgentStep[]) => `${steps.filter((st) => st.origin === "model" || st.origin === "stub").length} of ${steps.length}`;

test.describe("Remove: the step count is the loaded replay's", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.skip(() => !hasSubReplay(), "no replay recorded for the deck without " + REMOVE);

  test(`removing ${REMOVE}: the stamp counts the replay that loaded, never the parent run's steps`, async ({ page }) => {
    const parent = recording("pennywell");
    const sub = recording(`pennywell:without:${REMOVE.toLowerCase()}`);
    // The server serves the replay recorded for this make-up, steps and all.
    const served = await serverResult(page, inputs(parent).filter((c) => c.title !== REMOVE));
    expect(served.steps).toEqual(sub.steps);
    // Leak trap: the Remove's answer drops one chosen step, so its count can't equal the parent run's count.
    const dropped = sub.steps!.find((st) => st.origin === "model" || st.origin === "stub")!;
    const loaded = sub.steps!.filter((st) => st !== dropped);
    expect(choseOf(loaded)).not.toBe(choseOf(parent.steps!));
    await page.route(`${URL}/api/check?stream=1`, async (route) => {
      if ((route.request().postDataJSON() as { comps: unknown[] }).comps.length !== parent.comps.length - 1) return route.continue();
      const res = await route.fetch();
      const body = (await res.text()).trim().split("\n").map((l) => JSON.parse(l))
        .map((ev) => (ev.type === "result" ? { ...ev, result: { ...ev.result, steps: ev.result.steps.filter((st: AgentStep) => st.n !== dropped.n) } } : ev));
      await route.fulfill({ response: res, body: body.map((ev) => JSON.stringify(ev)).join("\n") + "\n" });
    });
    await runPennywell(page);
    await expect(page.getByTestId("recorded-stamp")).toContainText(`chose ${choseOf(parent.steps!)} steps`);
    // Every stamp text from the click until the run is done.
    await page.evaluate(() => {
      const w = window as unknown as { __stamps: string[] };
      w.__stamps = [];
      new MutationObserver(() => { const t = document.querySelector("[data-testid=recorded-stamp]")?.textContent; if (t && t !== w.__stamps.at(-1)) w.__stamps.push(t); })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await page.getByRole("button", { name: `Remove ${REMOVE}` }).click();
    await waitIdle(page);
    const stamps = await page.evaluate(() => (window as unknown as { __stamps: string[] }).__stamps);
    expect(stamps.length).toBeGreaterThan(0);
    for (const t of stamps) expect(t).not.toContain(`chose ${choseOf(parent.steps!)} steps`);
    const result = { ...served, steps: loaded };
    await expect(page.getByTestId("recorded-stamp")).toHaveText(`${recordedStamp(result, { date: false })}.`);
    await expect(page.getByTestId("chose-count")).toContainText(`${choseOf(loaded)} steps`);
  });
});

/** Each scored comp's "below next" gap, from the scores as shown (3 decimals), and the exact gap at 3 decimals. */
const gapsOf = (r: CheckResult) => {
  const scored = r.comps.filter((c) => c.rank && typeof c.fit?.affinity === "number");
  return scored.filter((c) => c.rank!.gapToNext !== undefined).map((c) => {
    const next = scored.find((x) => x.rank!.rank === c.rank!.rank - 1)!;
    // Independent of lib/rank-display.ts: next shown score minus this shown score.
    const shown = ((Math.round(Number(next.fit!.affinity!.toFixed(3)) * 1000) - Math.round(Number(c.fit!.affinity!.toFixed(3)) * 1000)) / 1000).toFixed(3);
    return { key: c.key, title: c.match.input.title, cut: !!(c.considerCutting && c.cutLabel), shown, exact: c.rank!.gapToNext!.toFixed(3) };
  });
};
const rankText = (page: Page, title: string) => page.locator(`[data-testid=comp-row][data-title="${title}"] [data-testid=rank]`);
const one = (s: string, re: RegExp, what: string) => { const m = s.match(re); expect(m, `${what}: ${s.slice(0, 200)}`).toBeTruthy(); return m![1]; };
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every surface's gap for each comp: the row, the Why line, the verdict fit line (cut comp), print, Markdown, CSV. */
async function surfaces(page: Page, gaps: ReturnType<typeof gapsOf>) {
  const md = await download(page, "Export Markdown"), csv = await download(page, "Export CSV");
  const head = csv.split("\n")[0].split(","), gi = head.indexOf("gap_to_next"), ri = head.indexOf("reasons");
  const csvRows = csv.trim().split("\n").slice(1).map((l) => l.slice(1, -1).split('","').map((x) => x.replace(/""/g, '"')));
  const out: Record<string, Record<string, string>> = {};
  for (const g of gaps) {
    const t = reEsc(g.title), o: Record<string, string> = {};
    o.row = one(await rankText(page, g.title).innerText(), /([\d.]+) below next/, `row ${g.title}`);
    const row = page.locator(`[data-testid=comp-row][data-title="${g.title}"]`);
    if ((await row.getByTestId("comp-toggle").getAttribute("aria-expanded")) !== "true") await row.getByTestId("comp-toggle").click();
    const why = (await page.locator(`[id="detail-${g.key}"] [data-testid=why]`).innerText());
    o.why = one(why, /([\d.]+) below the next comp/, `Why ${g.title}`);
    const mdRow = md.split("\n").find((l) => new RegExp(`^\\| ${t}\\b`).test(l))!;
    o.mdGap = mdRow.split(" | ")[5];
    o.mdWhy = one(mdRow, /([\d.]+) below the next comp/, `md Why ${g.title}`);
    const cr = csvRows.find((r) => r[0].startsWith(g.title))!;
    o.csvGap = cr[gi];
    o.csvWhy = one(cr[ri], /([\d.]+) below the next comp/, `csv Why ${g.title}`);
    if (g.cut) {
      o.whyCut = one(why, /Gap ([\d.]+) vs spread/, "Why cut gap");
      const fit = await page.locator("[data-testid=verdict-line][data-kind=fit]").innerText();
      expect(fit).toContain(g.title);
      o.verdict = one(fit, /, ([\d.]+) below the next comp/, "verdict");
      o.mdVerdict = one(md.split("\n").find((l) => l.startsWith("- ") && l.includes(`${g.title} (`))!, /, ([\d.]+) below the next comp/, "md verdict");
      o.mdWhyCut = one(mdRow, /Gap ([\d.]+) vs spread/, "md cut gap");
      await page.emulateMedia({ media: "print" });
      o.printRow = one(await rankText(page, g.title).innerText(), /([\d.]+) below next/, "print row");
      o.printVerdict = one(await page.locator("[data-testid=verdict-line][data-kind=fit]").innerText(), /, ([\d.]+) below the next comp/, "print verdict");
      await page.emulateMedia({ media: "screen" });
      // The step log (screen and Markdown) quotes the same gap wherever it names the lowest comp's gap.
      if (g.exact !== g.shown) {
        expect(md).not.toContain(`${g.exact} below the next comp`);
        expect(md).not.toMatch(new RegExp(`\\bgap\\b(?: to next)?:?\\s+${reEsc(g.exact)}(?!\\d)`, "i"));
        expect(await page.locator("body").innerText()).not.toMatch(new RegExp(`${reEsc(g.exact)} below the next comp|\\bgap\\b(?: to next)?:?\\s+${reEsc(g.exact)}(?!\\d)`, "i"));
      }
    }
    out[g.title] = o;
  }
  return out;
}
async function download(page: Page, label: string) {
  await openExport(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
  return readFileSync((await dl.path())!, "utf8");
}

test.describe("One gap on every surface", () => {
  test.use({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  test(`row, verdict, Why, print and exports show the same gap, full deck and without ${REMOVE}`, async ({ page }) => {
    const parent = recording("pennywell");
    const after = await serverResult(page, inputs(parent).filter((c) => c.title !== REMOVE));
    // The unit test's invented scores (test/fixtures/fake-gaps.ts) never equal a recorded score at 3 or 6 decimals.
    const real = new Set([parent, after].flatMap((r) => r.comps.flatMap((c) => typeof c.fit?.affinity === "number" ? [c.fit.affinity.toFixed(3), c.fit.affinity.toFixed(6)] : [])));
    for (const f of FAKE_SCORES) { expect(real.has(f.toFixed(3)), "fake score collides with a recorded one").toBe(false); expect(real.has(f.toFixed(6))).toBe(false); }
    await runPennywell(page);
    const states: [string, ReturnType<typeof gapsOf>][] = [["6 comps", gapsOf(parent)]];
    const six = await surfaces(page, states[0][1]);
    await page.getByRole("button", { name: `Remove ${REMOVE}` }).click();
    await waitIdle(page);
    states.push([`without ${REMOVE}`, gapsOf(after)]);
    const five = await surfaces(page, states[1][1]);
    // The removed state must exercise a gap where rounding the exact gap and differencing the shown scores disagree.
    expect(states[1][1].some((g) => g.cut && g.exact !== g.shown), "the removed state's cut comp should differ").toBe(true);
    for (const [[name, gaps], seen] of [[states[0], six], [states[1], five]] as const) {
      for (const g of gaps) for (const [where, v] of Object.entries(seen[g.title])) expect(v, `${name} · ${g.title} · ${where}`).toBe(g.shown);
      expect(gaps.some((g) => g.cut), `${name} has a cut comp`).toBe(true);
    }
  });
});
