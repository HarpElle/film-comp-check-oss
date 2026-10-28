/**
 * WP-F Stop, the cold-run skeleton map, CLS < 0.05 through a cold run and CLS < 0.1 on the landing load, on a no-key
 * server (0 Qloo calls).
 * A run is held open by not answering /api/check; titles and counts come from the recording.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { CheckResult } from "../lib/types";
import { waitIdle } from "./helpers";

const URL = process.env.QA_HANDOFF_URL;
const STORE = process.env.QA_HANDOFF_STORE;
test.skip(!URL || !STORE, "run through e2e/run-handoff.sh");

const recording = (id: string): CheckResult =>
  JSON.parse(readFileSync(join(STORE!, createHash("sha256").update(`sample:replay:${id}`).digest("hex") + ".json"), "utf8")).v.result;
const hold = (page: Page) => page.route(/\/api\/check/, () => { /* never answered: the run stays open until Stop */ });
const sample = (page: Page) => page.getByRole("button", { name: "Try the Pennywell sample" }).first().click();

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test.describe(`Stop and skeleton at ${vp.width}`, () => {
    test.use({ viewport: vp });

    test("cold run: the map skeleton has its frame, axes and box and no dots; Stop goes back to the box with the list", async ({ page }) => {
      await page.goto(URL! + "/");
      await hold(page);
      await sample(page);
      const sk = page.getByTestId("map-skeleton");
      await expect(sk).toBeVisible();
      await expect(page.getByTestId("map-skeleton-frame")).toHaveCount(1);
      await expect(page.getByTestId("map-skeleton-box")).toHaveCount(1);
      await expect(sk.getByTestId("map-x-title")).toBeVisible();
      await expect(sk.getByTestId("map-y-title")).toHaveCount(1);
      await expect(page.getByTestId("map-point")).toHaveCount(0);
      await expect(page.getByTestId("stop")).toHaveText("Stop");
      await page.getByTestId("stop").click();
      await expect(page.getByTestId("busy")).toHaveCount(0);
      await expect(page.getByTestId("error-state")).toHaveCount(0);
      await expect(page.getByTestId("loading-state")).toHaveCount(0);
      await expect(page.locator("#comps")).toBeVisible();
      const titles = recording("pennywell").comps.map((c) => c.match.input.title);
      for (const t of titles) await expect(page.locator("#comps")).toHaveValue(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });

    test("Stop during a Remove keeps the last result and puts the comp back", async ({ page }) => {
      const rec = recording("pennywell");
      const title = rec.comps.at(-1)!.match.input.title;
      await page.goto(URL! + "/");
      await sample(page);
      await waitIdle(page);
      const scores = () => page.getByTestId("score").evaluateAll((els) => els.map((e) => e.getAttribute("data-score")));
      const before = await scores();
      await hold(page);
      await page.getByRole("button", { name: `Remove ${title}` }).click();
      await page.getByTestId("stop").click();
      await expect(page.getByTestId("busy")).toHaveCount(0);
      await expect(page.getByTestId("error-state")).toHaveCount(0);
      await expect(page.getByTestId("comp-row")).toHaveCount(rec.comps.length);
      await expect(page.getByTestId("removed-row")).toHaveCount(0);
      expect(await scores()).toEqual(before);
      await expect(page.getByRole("button", { name: `Remove ${title}` })).toBeVisible();
    });

    test("landing load: CLS < 0.1, the sample result is in the first HTML, no hydration error", async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number; __shifts: string[] };
        w.__cls = 0; w.__shifts = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean; startTime: number; sources?: { node?: Node }[] }[]) {
            if (e.hadRecentInput) continue;
            w.__cls += e.value;
            w.__shifts.push(`${e.value.toFixed(4)} @${Math.round(e.startTime)} ${(e.sources ?? []).map((s) => (s.node as HTMLElement | undefined)?.className || s.node?.nodeName).join(",")}`);
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(URL! + "/");
      const html = await res!.text();
      // The server render carries the landing's sample result, so nothing is inserted above the fold after load.
      expect(html).toContain('data-testid="sample-verdict"');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByTestId("sample-verdict")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      const { cls, shifts } = await page.evaluate(() => { const w = window as unknown as { __cls: number; __shifts: string[] }; return { cls: w.__cls, shifts: w.__shifts }; });
      console.log(`landing CLS ${vp.width}: ${cls.toFixed(4)} ${JSON.stringify(shifts)}`);
      expect(cls, shifts.join("\n")).toBeLessThan(0.1);
      expect(errors.filter((e) => /hydrat|did not match|418|423|425/i.test(e))).toEqual([]);
    });

    test("CLS < 0.05 through a cold run", async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number; __shifts: string[] };
        w.__cls = 0; w.__shifts = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
            if (e.hadRecentInput) continue;
            w.__cls += e.value;
            w.__shifts.push(`${e.value.toFixed(4)} @${Math.round((e as unknown as { startTime: number }).startTime)} ${(e.sources ?? []).map((s) => (s.node as HTMLElement | undefined)?.className || s.node?.nodeName).join(",")}`);
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(URL! + "/");
      await page.evaluate(() => document.fonts.ready);
      // From the click: the landing settles first (its sample result arrives with /api/status), then the counter restarts.
      await expect(page.getByTestId("sample-verdict")).toBeVisible();
      await page.waitForTimeout(500);
      // The answer is held 1 s, past the 500 ms input window, so the skeleton-to-result swap counts.
      await page.route(/\/api\/check/, async (r) => { await new Promise((res) => setTimeout(res, 1000)); await r.continue(); });
      const t0 = await page.evaluate(() => { const w = window as unknown as { __cls: number; __shifts: string[]; __load: string[] }; w.__load = w.__shifts; w.__cls = 0; w.__shifts = []; return performance.now(); });
      await sample(page);
      await waitIdle(page);
      await page.waitForTimeout(300);
      console.log(`click at ${Math.round(t0)}; landing load shifts (not part of the run): ${JSON.stringify(await page.evaluate(() => (window as unknown as { __load: string[] }).__load))}`);
      const { cls, shifts } = await page.evaluate(() => { const w = window as unknown as { __cls: number; __shifts: string[] }; return { cls: w.__cls, shifts: w.__shifts }; });
      console.log(`CLS ${vp.width}: ${cls.toFixed(4)} ${JSON.stringify(shifts)}`);
      expect(cls, shifts.join("\n")).toBeLessThan(0.05);
    });
  });
}
