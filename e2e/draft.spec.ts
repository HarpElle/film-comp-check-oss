/**
 * Draft saving ("Sample vs draft"): the user's own comps stay in this browser's localStorage, a
 * sample run never overwrites them, and no draft text ever leaves the page. No-key server, 0 Qloo calls.
 */
import { expect, test } from "@playwright/test";
import { DRAFT_KEY, DRAFT_SAVED } from "../lib/draft";
import { PRIVACY_FOOTER } from "../lib/messages";
import { waitIdle } from "./helpers";

const URL = process.env.QA_HANDOFF_URL;
test.skip(!URL, "run through e2e/run-handoff.sh");

// Invented titles, 8 lines.
const LINES = Array.from({ length: 8 }, (_, i) => `Draftfilm Number ${i + 1} (${2001 + i})`);
const DRAFT = LINES.join("\n");

for (const vp of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
  test(`a typed 8-line draft is kept in this browser only and survives a sample run (${vp.width})`, async ({ page }) => {
    await page.setViewportSize(vp);
    const sent: string[] = [];
    page.on("request", (r) => sent.push(`${r.url()} ${r.postData() ?? ""}`));
    await page.goto(URL! + "/");
    await expect(page.getByTestId("draft-saved")).toHaveText("");
    await page.locator("#comps").fill(DRAFT);
    await expect(page.getByTestId("draft-saved")).toHaveText(DRAFT_SAVED);
    expect(await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)).toBe(DRAFT);
    expect(await page.evaluate(() => Object.keys(sessionStorage).length + document.cookie.length)).toBe(0);

    await page.reload();
    await expect(page.locator("#comps")).toHaveValue(DRAFT);
    await expect(page.getByTestId("draft-saved")).toHaveText(DRAFT_SAVED);

    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    await page.getByRole("button", { name: "Edit comps" }).click();
    await expect(page.locator("#comps")).not.toHaveValue(DRAFT);
    await page.getByTestId("back-to-draft").click();
    await expect(page.locator("#comps")).toHaveValue(DRAFT);
    expect(await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)).toBe(DRAFT);

    // Nothing about the draft went to the server, and the footer is PR #2's, unchanged.
    expect(sent.filter((s) => s.includes("Draftfilm") || s.includes("Draftfilm".replace(" ", "+")))).toEqual([]);
    await expect(page.getByTestId("privacy-footer")).toHaveText(PRIVACY_FOOTER);
  });
}
