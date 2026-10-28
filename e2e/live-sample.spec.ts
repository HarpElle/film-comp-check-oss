/**
 * "Run live on Qloo" on the sample decks. Started by e2e/run-live-sample.sh: a mocked Qloo answering from
 * synthetic recordings (QA_MOCK) and three production servers with the in-memory store:
 *   QA_LIVE_HIGH  quota well above the floor: the button and the second live run
 *   QA_LIVE_LOW   just above the reserve: the button, no second run (quiet line instead)
 *   QA_LIVE_NONE  no quota reading this month: no button, the quiet line
 *   QA_LIVE_OFF   high quota, SAMPLE_LIVE unset (the default): no button and no quiet line on either sample, only "Run again"
 * The recording date in the labels is read from the seeded recording (QA_RECORDED_AT), never written here.
 * Each test is its own visitor (x-real-ip), since a visitor gets one live sample run a day.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { waitIdle } from "./helpers";
import { PENNYWELL } from "../lib/demo";

const OFF = process.env.QA_LIVE_OFF, HIGH = process.env.QA_LIVE_HIGH, LOW = process.env.QA_LIVE_LOW, NONE = process.env.QA_LIVE_NONE, MOCK = process.env.QA_MOCK, AT = process.env.QA_RECORDED_AT;
const QA = path.join(__dirname, "..", "qa");
const QUIET = "Run again on your own deck to compare live.";
const QUIET_AFTER = "Run again on your own deck to compare live.";
const SAMPLE_VISITOR_LIMIT = "You've used today's live run of a sample deck. The recorded samples still run.";
const date = () => new Date(AT!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const DRIFTED = PENNYWELL[1].title;

async function visitor(browser: Browser, ip: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { "x-real-ip": ip } });
  return ctx.newPage();
}
async function sample(page: Page, url: string, name = "Pennywell") {
  await page.goto(url);
  await page.getByRole("button", { name: `Try the ${name} sample` }).click();
  await waitIdle(page);
  await expect(page.getByTestId("recorded-stamp")).toBeVisible();
}
async function drift(page: Page, d: Record<string, number>) { const r = await page.request.post(`${MOCK}/__mock`, { data: { drift: d } }); expect(r.ok()).toBe(true); }
async function mockCalls(page: Page): Promise<number> { return (await (await page.request.get(`${MOCK}/__mock`)).json()).calls; }
async function runLive(page: Page, testId = "run-live-qloo") {
  await page.getByTestId(testId).click();
  await waitIdle(page);
  await expect(page.getByTestId("live-compare")).toBeVisible();
}

test.describe("Run live on Qloo (mocked Qloo, in-memory store)", () => {
  test.skip(!HIGH || !MOCK || !AT, "run e2e/run-live-sample.sh");

  for (const name of ["Pennywell", "Dream Hackers"]) {
    test(`SAMPLE_LIVE off (default), quota open: ${name} shows only "Run again", no "Run live on Qloo", no Qloo call`, async ({ browser }) => {
      test.skip(!OFF, "run e2e/run-live-sample.sh");
      const page = await visitor(browser, name === "Pennywell" ? "10.0.1.1" : "10.0.1.2");
      const before = await mockCalls(page);
      const st = await (await page.request.get(`${OFF}/api/status`)).json();
      expect(st.sampleLiveOn).toBe(false);
      await sample(page, OFF!, name);
      const line = page.getByTestId("calls").locator("xpath=..");
      await expect(page.getByTestId("run-live-qloo")).toHaveCount(0);
      await expect(page.getByTestId("sample-quiet-line")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Run live on Qloo");
      await expect(page.getByTestId("replay-again")).toHaveText("Run again");
      await expect(line.getByRole("button")).toHaveCount(1);
      // The server refuses a live sample run too, without a Qloo call.
      const r = await page.request.post(`${OFF}/api/check`, { data: { comps: st.samples.find((s: { id: string }) => s.id === (name === "Pennywell" ? "pennywell" : "dreamhackers")).comps, live: "sample" } });
      expect((await r.json()).error).toBe("A live run of the sample isn't available right now. The recorded run still works.");
      expect(await mockCalls(page)).toBe(before);
      if (name === "Pennywell") await page.screenshot({ path: path.join(QA, "sample-live-off-pennywell.png") });
    });
  }

  test("no quota reading: no button, the quiet line, no Qloo call", async ({ browser }) => {
    const page = await visitor(browser, "10.0.0.1");
    const before = await mockCalls(page);
    await sample(page, NONE!);
    await expect(page.getByTestId("run-live-qloo")).toHaveCount(0);
    await expect(page.getByTestId("sample-quiet-line")).toHaveText(QUIET);
    expect(await mockCalls(page)).toBe(before);
    await page.screenshot({ path: path.join(QA, "design2-sample-quiet-line.png") });
  });

  test("live run vs recording with a drift on one comp, then the second live run (quota well above the floor)", async ({ browser }) => {
    const page = await visitor(browser, "10.0.0.2");
    await drift(page, { [DRIFTED]: 0.0042 });
    await sample(page, HIGH!);
    await expect(page.getByTestId("run-live-qloo")).toBeVisible();
    await expect(page.getByTestId("sample-quiet-line")).toHaveCount(0);
    const before = await mockCalls(page);
    await runLive(page);
    const calls = (await mockCalls(page)) - before;
    expect(calls).toBeGreaterThan(0);
    // existing live wording, no recorded stamp
    await expect(page.getByTestId("recorded-stamp")).toHaveCount(0);
    await expect(page.getByTestId("calls")).toHaveText(`Live: ${calls} Qloo calls just now.`);
    await expect(page.getByTestId("live-compare-label")).toHaveText(`Live run vs recording from ${date()}. Qloo's data can change between them.`);
    const summary = await page.getByTestId("live-compare-summary").innerText();
    expect(summary).toContain(`Differs: ${DRIFTED} (+0.004).`);
    expect(summary).toMatch(/^Matched to 6 decimals: /);
    const rows = page.getByTestId("live-compare-row");
    await expect(rows).toHaveCount(6);
    await expect(page.locator(`[data-testid="live-compare-row"][data-same6="no"]`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="live-compare-row"][data-title="${DRIFTED}"]`)).toHaveAttribute("data-diff6", "0.004200");
    await expect(page.locator(`[data-testid="live-compare-row"][data-title="${DRIFTED}"] [data-testid="live-compare-diff"]`)).toHaveText("+0.004");
    await expect(page.locator('[data-testid="live-compare-row"][data-same6="yes"]')).toHaveCount(5);
    await page.getByTestId("live-compare").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(QA, "design2-live-vs-recording.png") });
    // second live run: shown because the quota is well above the floor; same drift both times, so all match
    await expect(page.getByTestId("run-live-second")).toBeVisible();
    const b2 = await mockCalls(page);
    await runLive(page, "run-live-second");
    expect(await mockCalls(page)).toBeGreaterThan(b2);
    await expect(page.getByTestId("live-compare-label")).toHaveText("Second live run vs first live run (minutes apart).");
    await expect(page.getByTestId("live-compare-summary")).toHaveText("All 6 fit scores matched to 6 decimals.");
    await expect(page.getByTestId("run-live-second")).toHaveCount(0);
    await page.getByTestId("live-compare").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(QA, "design2-live-vs-live.png") });
  });

  test("identical case: every comp matched the recording to 6 decimals", async ({ browser }) => {
    const page = await visitor(browser, "10.0.0.3");
    await drift(page, {});
    await sample(page, HIGH!);
    await runLive(page);
    await expect(page.getByTestId("live-compare-summary")).toHaveText("All 6 fit scores matched to 6 decimals.");
    await expect(page.locator('[data-testid="live-compare-row"][data-same6="yes"]')).toHaveCount(6);
    for (const d of await page.getByTestId("live-compare-diff").allInnerTexts()) expect(d).toBe("\u00b10.000");
  });

  test("quota just above the reserve: the button, but no second run (the quiet line instead)", async ({ browser }) => {
    const page = await visitor(browser, "10.0.0.4");
    await drift(page, {});
    // The live run's own responses report the quota (x-month-ratelimit-remaining): keep it just above the reserve.
    expect((await page.request.post(`${MOCK}/__mock`, { data: { remaining: 1060 } })).ok()).toBe(true);
    await sample(page, LOW!);
    await runLive(page);
    await expect(page.getByTestId("run-live-second")).toHaveCount(0);
    await expect(page.getByTestId("live-compare").getByTestId("sample-quiet-line")).toHaveText(QUIET_AFTER);
    await page.request.post(`${MOCK}/__mock`, { data: { remaining: 100000 } });
  });

  test("visitor limit: a second live sample run the same day gets the message, sample buttons stay", async ({ browser }) => {
    const page = await visitor(browser, "10.0.0.5");
    await drift(page, {});
    await sample(page, HIGH!);
    await runLive(page);
    await sample(page, HIGH!); // a fresh page load; the button still shows (the gate is about quota)
    const before = await mockCalls(page);
    await page.getByTestId("run-live-qloo").click();
    await waitIdle(page);
    await expect(page.getByTestId("error-detail")).toHaveText(SAMPLE_VISITOR_LIMIT);
    await expect(page.getByTestId("error-sample")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    expect(await mockCalls(page)).toBe(before);
  });
});
