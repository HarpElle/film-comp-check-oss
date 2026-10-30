/**
 * Error states (lib/error-state.ts) on a no-key server, 0 Qloo calls. A failure is simulated by answering
 * /api/check with the server's own error sentence; "Claude down" rewrites the recorded replay's result as a
 * live Claude run whose choices all fell back. Counts and labels are read from the recording, not written here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { removalSummary } from "../lib/change-summary";
import { AGENT_DOWN, CHECK_FAILED, MAX_COMPS, MIN_COMPS, runError, several, unmatched } from "../lib/error-state";
import { formatCompLines } from "../lib/parse";
import { VISITOR_LIMIT } from "../lib/messages";
import { shareSearch } from "../lib/share";
import { CANT_REACH } from "../lib/messages";
import type { CheckResult } from "../lib/types";
import { waitIdle } from "./helpers";

const URL = process.env.QA_HANDOFF_URL;
const STORE = process.env.QA_HANDOFF_STORE;
test.skip(!URL || !STORE, "run through e2e/run-handoff.sh");

const recording = (id: string): CheckResult =>
  JSON.parse(readFileSync(join(STORE!, createHash("sha256").update(`sample:replay:${id}`).digest("hex") + ".json"), "utf8")).v.result;
const failWith = (page: Page, message: string) =>
  page.route(/\/api\/check/, (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", error: message }) + "\n" }));
const sample = (page: Page) => page.getByRole("button", { name: "Try the Pennywell sample" }).first().click();
const invented = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Invented Film ${i + 1}`, year: 2001 + i }));

async function expectRunError(page: Page, message: string, removing?: string) {
  const v = runError(message, removing);
  await expect(page.getByTestId("check-failed")).toHaveText(CHECK_FAILED);
  await expect(page.getByTestId("error-headline")).toHaveText(v.headline);
  await expect(page.getByTestId("error-body")).toHaveText(v.body);
  expect(await page.getByTestId("error-state").innerText()).not.toMatch(/@/);
  return v;
}

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test.describe(`error states at ${vp.width}`, () => {
    test.use({ viewport: vp });

    test("Qloo down: no verdict, the list is kept, Try again and a sample deck", async ({ page }) => {
      await page.goto(URL! + "/");
      await failWith(page, CANT_REACH);
      await sample(page);
      await waitIdle(page);
      await expectRunError(page, CANT_REACH);
      await expect(page.getByTestId("error-detail")).toHaveCount(0); // the Qloo card has no small server line under it
      await expect(page.getByTestId("error-retry")).toHaveText("Try again");
      await expect(page.getByTestId("error-sample")).toHaveText("Pennywell sample");
      await expect(page.getByTestId("results")).toHaveCount(0);
      await expect(page.getByTestId("last-result")).toHaveCount(0);
      await page.unroute(/\/api\/check/);
      await page.getByTestId("error-retry").click();
      await waitIdle(page);
      await expect(page.getByTestId("comp-row")).toHaveCount(recording("pennywell").comps.length);
    });

    test("daily limit: resets at midnight Central time, only the sample deck button", async ({ page }) => {
      await page.goto(URL! + "/");
      await failWith(page, VISITOR_LIMIT);
      await sample(page);
      await waitIdle(page);
      const v = await expectRunError(page, VISITOR_LIMIT);
      expect(v.body).toMatch(/reset at midnight Central time\.$/);
      await expect(page.getByTestId("error-retry")).toHaveCount(0);
      await expect(page.getByTestId("error-sample")).toBeVisible();
    });

    test("something else broke: no contact address, no repeated detail", async ({ page }) => {
      await page.goto(URL! + "/");
      await failWith(page, CHECK_FAILED);
      await sample(page);
      await waitIdle(page);
      await expectRunError(page, CHECK_FAILED);
      await expect(page.getByTestId("error-detail")).toHaveCount(0);
    });

    test("Remove failed: previous results unchanged and labeled, Try again finishes the Remove", async ({ page }) => {
      const rec = recording("pennywell");
      const target = rec.comps.find((c) => c.match.input.title === "Midsommar")!.match.input.title;
      await page.goto(URL! + "/");
      await sample(page);
      await waitIdle(page);
      await failWith(page, CANT_REACH);
      await page.getByRole("button", { name: `Remove ${target}` }).click();
      await waitIdle(page);
      await expectRunError(page, CANT_REACH, target);
      await expect(page.getByTestId("last-result")).toHaveText(`Last result: ${rec.comps.length} comps`);
      await expect(page.getByTestId("comp-row")).toHaveCount(rec.comps.length);
      await expect(page.getByTestId("verdict")).toBeVisible();
      await page.unroute(/\/api\/check/);
      await page.getByTestId("error-retry").click();
      await waitIdle(page);
      await expect(page.getByTestId("comp-row")).toHaveCount(rec.comps.length - 1);
      await expect(page.getByTestId("error-state")).toHaveCount(0);
      const after = await (await page.request.post(`${URL}/api/check?stream=1`, { data: { comps: rec.comps.map((c) => c.match.input).filter((c) => c.title !== target) } })).text();
      const res = after.trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "result").result;
      await expect(page.getByTestId("change-summary-text")).toHaveText(removalSummary(target, rec, res));
    });

    test("match panels: an unmatched comp (Edit comps) and a comp with several records (pick one puts its year on the line)", async ({ page }) => {
      const rec = recording("pennywell");
      const [u, m] = [rec.comps[0].match, rec.comps[1].match];
      const other = { title: m.matchedTitle!, year: (m.matchedYear ?? 2000) - 40, type: "Film" as const }; // invented second record
      await page.route(/\/api\/check/, async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).trim().split("\n").map((l) => {
          const e = JSON.parse(l);
          if (e.type === "result") {
            const r = e.result as CheckResult;
            e.result = { ...r, comps: r.comps.map((c, i) => i === 0 ? { ...c, match: { input: c.match.input, badge: "Unmatched", reason: "" }, fit: undefined }
              : i === 1 ? { ...c, match: { ...c.match, options: [{ title: m.matchedTitle!, year: m.matchedYear, type: "Film" }, other] } } : c) };
          }
          return JSON.stringify(e);
        }).join("\n") + "\n";
        await route.fulfill({ response: res, body });
      });
      await page.goto(URL! + "/");
      await sample(page);
      await waitIdle(page);
      const panels = page.getByTestId("match-panel");
      await expect(panels).toHaveCount(2);
      const v3 = unmatched(u.input.title), v4 = several(m.input.title);
      await expect(panels.nth(0)).toHaveAttribute("data-kind", "unmatched");
      await expect(panels.nth(0).getByTestId("match-panel-headline")).toHaveText(v3.headline);
      await expect(panels.nth(0).getByTestId("match-panel-body")).toHaveText(v3.body);
      await expect(panels.nth(1).getByTestId("match-panel-headline")).toHaveText(v4.headline);
      await expect(panels.nth(1).getByTestId("match-panel-body")).toHaveText(v4.body);
      const opts = panels.nth(1).getByTestId("match-option");
      await expect(opts).toHaveCount(2);
      await expect(opts.nth(1)).toHaveText(`${other.title} (${other.year}) · Film`);
      await panels.nth(0).getByTestId("match-edit").click();
      await expect(page.locator("#comps")).toBeFocused();
      await opts.nth(1).click();
      await expect(page.locator("#comps")).toBeFocused();
      expect((await page.locator("#comps").inputValue()).split("\n")[1]).toBe(formatCompLines([{ ...m.input, title: other.title, year: other.year }]));
    });

    test("Claude down, Qloo answered: complete verdict plus the agent notice", async ({ page }) => {
      await page.route(/\/api\/check/, async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).trim().split("\n").map((l) => {
          const e = JSON.parse(l);
          if (e.type === "result") {
            const r = e.result as CheckResult;
            e.result = { ...r, provider: "claude", recorded: undefined, agentStats: { ...(r.agentStats ?? {}), apiErrors: 1 }, steps: (r.steps ?? []).map((s) => (s.origin === "model" ? { ...s, origin: "template" } : s)) };
          }
          return JSON.stringify(e);
        }).join("\n") + "\n";
        await route.fulfill({ response: res, body });
      });
      await page.goto(URL! + "/");
      await sample(page);
      await waitIdle(page);
      await expect(page.getByTestId("agent-down")).toContainText(AGENT_DOWN.headline);
      await expect(page.getByTestId("agent-down")).toContainText(AGENT_DOWN.body);
      await expect(page.getByTestId("agent-again")).toHaveText("Run the agent again");
      await expect(page.getByTestId("verdict")).toBeVisible();
      await expect(page.getByTestId("error-state")).toHaveCount(0);
    });

    test("bad decks from a share link: too few and too many, never sent", async ({ page }) => {
      const posts: string[] = [];
      page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });
      await page.goto(URL! + "/" + shareSearch(invented(MIN_COMPS - 1)));
      await expect(page.getByTestId("field-error-headline")).toHaveText(`Add at least ${MIN_COMPS} comps`);
      await expect(page.getByTestId("field-add")).toHaveText("Add comps");
      await page.goto(URL! + "/" + shareSearch(invented(MAX_COMPS + 2)));
      await expect(page.getByTestId("field-error-headline")).toHaveText(`Up to ${MAX_COMPS} comps per check`);
      await expect(page.getByTestId("field-error")).toContainText(`You entered ${MAX_COMPS + 2}. Remove 2 and run it again.`);
      await expect(page.locator("#comps")).toHaveAttribute("aria-describedby", /field-error/);
      await expect(page.locator("#comps")).toHaveAttribute("aria-invalid", "true");
      expect(posts).toEqual([]);
    });
  });
}
