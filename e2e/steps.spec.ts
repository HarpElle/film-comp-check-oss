/**
 * Step log and two-way note links, on the recorded Pennywell replay (no keys, 0 Qloo calls).
 * The step and comp of the note are read from the recording, not written here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { CheckResult } from "../lib/types";
import { waitIdle } from "./helpers";

const URL = process.env.QA_HANDOFF_URL;
const STORE = process.env.QA_HANDOFF_STORE;
test.skip(!URL || !STORE, "run through e2e/run-handoff.sh");
const recording = (id: string): CheckResult => JSON.parse(readFileSync(join(STORE!, createHash("sha256").update(`sample:replay:${id}`).digest("hex") + ".json"), "utf8")).v.result;

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test.describe(`step/note links at ${vp.width}`, () => {
    test.use({ viewport: vp });
    test("note link opens the log and focuses its step; the step link opens the comp and focuses its note; fixed steps stay folded", async ({ page }) => {
      const rec = recording("pennywell");
      const st = rec.steps!.find((s) => s.note)!;
      expect(st, "the recording has a tag note").toBeTruthy();
      const comp = rec.comps.find((c) => c.key === st.note!.comp)!;
      await page.goto(URL! + "/");
      await page.getByRole("button", { name: "Try the Pennywell sample" }).first().click();
      await waitIdle(page);
      // The log opens from "Show steps"; fixed steps stay hidden until their summary opens.
      const panel = page.getByTestId("steps");
      await expect(panel).toBeHidden();
      await expect(page.getByTestId("steps-toggle")).toHaveText("Show steps");
      await page.locator(`[data-testid=comp-row][data-key="${comp.key}"] [data-testid=comp-toggle]`).click();
      const marker = page.locator(`[data-testid=comp-detail][data-key="${comp.key}"]`).getByTestId("note-marker");
      await expect(marker).toHaveAttribute("data-step", String(st.n));
      const box = (await marker.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(24);
      await marker.click();
      const step = page.locator(`#step-${st.n}`);
      await expect(panel).toBeVisible();
      await expect(step).toBeFocused();
      await expect(step).toHaveClass(/link-target/);
      expect(await step.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(242, 248, 251)");
      if (st.origin === "core") await expect(page.getByTestId("always-run")).toHaveJSProperty("open", true);
      else await expect(page.getByTestId("always-run")).toHaveJSProperty("open", false);
      // Reverse: close the comp, follow the step's link back to the note.
      await page.locator(`[data-testid=comp-row][data-key="${comp.key}"] [data-testid=comp-toggle]`).click();
      await expect(page.locator(`#note-${comp.key}`)).toBeHidden();
      const back = step.getByTestId("step-note-link");
      await expect(back).toHaveText(`${comp.match.input.title} note \u2191`);
      expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      await back.click();
      const note = page.locator(`#note-${comp.key}`);
      await expect(note).toBeVisible();
      await expect(note).toBeFocused();
      await expect(note).toHaveClass(/link-target/);
      // The mark lasts until the next click.
      await page.mouse.click(5, 5);
      await expect(note).not.toHaveClass(/link-target/);
    });
  });
}
