/**
 * The demo's seeded state (docs/DEMO.md): /?sample=pennywell&without=Midsommar replays the recorded sample, then
 * removes Midsommar through the normal Remove. No keys, 0 Qloo calls. Expected labels come from the recording and
 * the server's own answer for the narrowed deck.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { removalSummary } from "../lib/change-summary";
import { CONSIDER_CUTTING } from "../lib/flag";
import type { CheckResult } from "../lib/types";
import { waitIdle } from "./helpers";

const URL = process.env.QA_HANDOFF_URL;
const STORE = process.env.QA_HANDOFF_STORE;
test.skip(!URL || !STORE, "run through e2e/run-handoff.sh");
const recording = (id: string): CheckResult =>
  JSON.parse(readFileSync(join(STORE!, createHash("sha256").update(`sample:replay:${id}`).digest("hex") + ".json"), "utf8")).v.result;
const REMOVE = "Midsommar";

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test(`seeded demo link lands on the Remove state with Consider cutting (${vp.width})`, async ({ page }) => {
    await page.setViewportSize(vp);
    const rec = recording("pennywell");
    const narrowed = rec.comps.map((c) => c.match.input).filter((c) => c.title !== REMOVE);
    const body = await (await page.request.post(`${URL}/api/check?stream=1`, { data: { comps: narrowed } })).text();
    const after: CheckResult = body.trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "result").result;
    expect(after.qlooCalls).toBe(0);
    const cut = after.comps.find((c) => c.considerCutting)!;
    expect(cut.cutLabel).toBe(CONSIDER_CUTTING); // the demo depends on it; the recording decides, not this test

    await page.goto(`${URL}/?sample=pennywell&without=${REMOVE}`);
    await expect(page.getByTestId("change-summary-text")).toHaveText(removalSummary(REMOVE, rec, after));
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(rec.comps.length - 1);
    await expect(page.locator(`[data-testid=comp-row][data-title="${cut.match.input.title}"]`)).toContainText(CONSIDER_CUTTING);
    await expect(page.getByTestId("undo-remove")).toBeVisible();
    await expect(page.getByTestId("calls")).toHaveText("No new Qloo calls.");
  });
}

test("/?sample=pennywell runs the recorded sample by itself", async ({ page }) => {
  await page.goto(`${URL}/?sample=pennywell`);
  await waitIdle(page);
  await expect(page.getByTestId("comp-row")).toHaveCount(recording("pennywell").comps.length);
  await expect(page.getByTestId("change-summary")).toHaveCount(0);
});
