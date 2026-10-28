/**
 * WP-K 720-1023 (Rank merges under Fit score, map under the verdict at 288 px) and the WP-I input details
 * (placeholder, live count, Cmd/Ctrl+Enter), on a no-key server, 0 Qloo calls. Rank text is read from the page at 1280.
 */
import { expect, test } from "@playwright/test";
import { waitIdle } from "./helpers";
import { MIN_COMPS } from "../lib/error-state";

const URL = process.env.QA_HANDOFF_URL;
test.skip(!URL || !process.env.QA_HANDOFF_STORE, "run through e2e/run-handoff.sh");
const sample = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Try the Pennywell sample" }).first().click();

test("720-1023: no Rank column; each scored row shows the Rank column's text under its fit score; map 288 px under the verdict", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(URL! + "/");
  await sample(page);
  await waitIdle(page);
  const ranks = await page.getByTestId("rank").allInnerTexts();
  expect(ranks.filter(Boolean).length).toBeGreaterThan(0);
  await expect(page.getByRole("columnheader", { name: "Rank" })).toBeVisible();
  for (const width of [900, 721, 1023]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("columnheader", { name: "Rank" })).toBeHidden();
    await expect(page.getByTestId("rank").first()).toBeHidden();
    const under = await page.getByTestId("score").evaluateAll((els) => els.map((e) => getComputedStyle(e, "::after").content.replace(/^"|"$/g, "").replace(/^none$/, "")));
    expect(under).toEqual(ranks);
    const map = (await page.getByTestId("deck-map").boundingBox())!, verdict = (await page.getByTestId("verdict").boundingBox())!;
    expect(Math.round(map.width)).toBe(288);
    expect(map.y).toBeGreaterThan(verdict.y + verdict.height - 1);
  }
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByRole("columnheader", { name: "Rank" })).toBeVisible();
  expect(await page.getByTestId("score").first().evaluate((e) => getComputedStyle(e, "::after").content)).toMatch(/^(none|normal)$/);
});

test("input: placeholder lines, a live count once there is text, Ctrl+Enter runs the check", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(URL! + "/");
  const box = page.locator("#comps");
  await box.fill(""); // the landing box may hold the sample deck
  expect((await box.getAttribute("placeholder"))!.split("\n")).toHaveLength(3);
  await expect(page.getByTestId("comp-count")).toHaveCount(0);
  const lines = (await box.getAttribute("placeholder"))!; // made-up deck from the spec's placeholder; never sent below
  await box.fill(lines.split("\n").slice(0, 2).join("\n"));
  await expect(page.getByTestId("comp-count")).toHaveText("2 comps");
  await box.fill("");
  await expect(page.getByTestId("comp-count")).toHaveCount(0);
  // Ctrl+Enter goes through the same gate as the button: while live checks are paused (this no-key server) it does nothing.
  const posts: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/check")) posts.push(r.url()); });
  await box.fill("Only one line");
  await expect(page.getByTestId("comp-count")).toHaveText("1 comp");
  await expect(page.getByRole("button", { name: "Check comps" })).toBeDisabled();
  await box.press("Control+Enter");
  await expect(page.getByTestId("field-error")).toHaveCount(0);
  // With live checks on (the server-rendered page with qlooLive flipped, in this browser only), a deck too short to
  // run shows the field message, no request.
  await page.route((u) => u.pathname === "/", async (r) => {
    const res = await r.fetch();
    const body = (await res.text()).replace(/(\\?"qlooLive\\?":)false/g, "$1true");
    await r.fulfill({ response: res, body });
  });
  await page.reload();
  await box.fill("Only one line");
  await expect(page.getByRole("button", { name: "Check comps" })).toBeEnabled();
  await box.press("Control+Enter");
  await expect(page.getByTestId("field-error-headline")).toHaveText(`Add at least ${MIN_COMPS} comps`);
  expect(posts).toEqual([]);
});
