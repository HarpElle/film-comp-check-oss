/**
 * Design acceptance for the top of page and results mode: frame, verdict, map, status lines, phones.
 * Runs through e2e/run-handoff.sh: a no-key server (QLOO_LIVE=0) on a copy of a recorded store, 0 Qloo calls.
 * Expected values are read from that recording at run time; no step numbers or Qloo values are written here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PRIVACY_FOOTER } from "../lib/messages";
import { assertMap, assertMapLabels, assertNoScroll, waitIdle } from "./helpers";

const URL = process.env.QA_HANDOFF_URL;
const STORE = process.env.QA_HANDOFF_STORE;
test.skip(!URL || !STORE, "run through e2e/run-handoff.sh");

type Comp = { key: string; match: { badge: string; input: { title: string }; matchedTitle?: string }; skew?: { age?: number; female?: number }; skewFlag?: unknown; skewSplit?: unknown; considerCutting?: boolean };
type Rec = { comps: Comp[]; deckMean?: { female: number; age: number }; verdictLines: string[] };
const recording = (id: string): Rec => {
  const f = join(STORE!, createHash("sha256").update(`sample:replay:${id}`).digest("hex") + ".json");
  return JSON.parse(readFileSync(f, "utf8")).v.result;
};
const flagged = (c: Comp) => !!c.skewFlag || !!c.skewSplit || !!c.considerCutting;
const onMap = (c: Comp) => !!(c.skewFlag || c.skewSplit);
// WP-E2 frame: plot 288 at (48, 4), 144 px per unit.
const px = (f: number) => 48 + 144 * (Math.max(-1, Math.min(1, f)) + 1);
const py = (a: number) => 4 + 144 * (1 - Math.max(-1, Math.min(1, a)));

async function runSample(page: Page, id: "pennywell" | "dreamhackers") {
  await page.goto(URL! + "/");
  await page.getByTestId(id === "pennywell" ? "sample-run" : "sample-dreamhackers").or(page.getByRole("button", { name: id === "pennywell" ? "Try the Pennywell sample" : "Try the Dream Hackers sample" })).first().click();
  await waitIdle(page);
  await page.evaluate(() => document.fonts.ready);
}

const visibleText = (page: Page) => page.locator("body").innerText();

for (const id of ["pennywell", "dreamhackers"] as const) {
  test.describe(`${id} at 1280x800`, () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("results mode: landing hidden, verdict first at 20 px with an icon per line, no visible Verdict label", async ({ page }) => {
      const rec = recording(id);
      await runSample(page, id);
      await expect(page.locator(".hero")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Try the Pennywell sample" })).toHaveCount(0);
      const lines = page.getByTestId("verdict-line");
      await expect(lines).toHaveCount(rec.verdictLines.length);
      for (const l of await lines.all()) {
        expect(await l.evaluate((e) => getComputedStyle(e).fontSize)).toBe("20px");
        expect(await l.evaluate((e) => getComputedStyle(e).lineHeight)).toBe("28px");
        const icon = l.locator(".v-icon svg");
        await expect(icon).toHaveCount(1);
      }
      expect(await page.locator('[data-testid="verdict-line"][data-kind="audience"]').evaluate((e) => getComputedStyle(e).fontWeight)).toBe("600");
      // Reads first: the verdict is the first content below the header (only the small sample label sits above it).
      const v = (await page.getByTestId("verdict").boundingBox())!;
      const map = (await page.getByTestId("deck-map").boundingBox())!;
      const table = (await page.getByTestId("results").boundingBox())!;
      expect(v.y).toBeLessThan(map.y + 40);
      expect(v.y).toBeLessThan(table.y);
      expect(await page.getByTestId("verdict-line").first().evaluate((e) => e.getBoundingClientRect().top)).toBeLessThan(120);
      // No visible "Verdict": the h1 is sr-only, and focus lands on it after the run (WP-A).
      await expect(page.getByRole("heading", { level: 1, name: "Verdict" })).toHaveClass(/sr-only/);
      await expect(page.getByTestId("verdict-heading")).toBeFocused();
      // Any element whose own text is "Verdict" is clipped to 1 px (sr-only), so nothing reads "Verdict" on screen.
      const shown = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && /^\s*verdict\s*$/i.test(e.textContent || "")).map((e) => { const r = e.getBoundingClientRect(); return r.width > 1 || r.height > 1 ? e.outerHTML : ""; }).filter(Boolean));
      expect(shown).toEqual([]);
    });

    test("\"Qloo's estimate\" appears exactly twice: the verdict and the map caption", async ({ page }) => {
      await runSample(page, id);
      const text = await visibleText(page);
      expect(text.match(/qloo['\u2019]s estimate/gi) ?? []).toHaveLength(2);
      expect(await page.getByTestId("verdict").innerText()).toMatch(/Qloo's estimate/);
      await expect(page.getByTestId("map-caption")).toHaveText("Audience lean · Qloo's estimate");
    });

    test("map: female lean across, age up with older at top, positions and deck average from the recording", async ({ page }) => {
      const rec = recording(id);
      await runSample(page, id);
      const plotted = rec.comps.filter((c) => c.match.badge === "Matched" && typeof c.skew?.age === "number" && typeof c.skew?.female === "number");
      await expect(page.getByTestId("map-point")).toHaveCount(plotted.length);
      for (const c of plotted) {
        const title = c.match.matchedTitle ?? c.match.input.title;
        const p = page.locator(`[data-testid="map-point"][data-title="${title}"]`);
        expect(Number(await p.getAttribute("data-cx"))).toBeCloseTo(px(c.skew!.female!), 6);
        expect(Number(await p.getAttribute("data-cy"))).toBeCloseTo(py(c.skew!.age!), 6);
      }
      // Older at the top, more female to the right, by rendered position.
      const pos = await page.getByTestId("map-marker").evaluateAll((ms) => ms.map((m) => { const r = m.getBoundingClientRect(); return { t: m.closest("g")!.getAttribute("data-title")!, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
      const by = (t: string) => pos.find((q) => q.t === t)!;
      const titled = plotted.map((c) => ({ t: c.match.matchedTitle ?? c.match.input.title, a: c.skew!.age!, f: c.skew!.female! }));
      const oldest = [...titled].sort((a, b) => b.a - a.a)[0], youngest = [...titled].sort((a, b) => a.a - b.a)[0];
      const mostF = [...titled].sort((a, b) => b.f - a.f)[0], mostM = [...titled].sort((a, b) => a.f - b.f)[0];
      expect(by(oldest.t).y).toBeLessThan(by(youngest.t).y);
      expect(by(mostF.t).x).toBeGreaterThan(by(mostM.t).x);
      await expect(page.getByTestId("map-x-title")).toHaveText("more male ← Female lean → more female");
      await expect(page.getByTestId("map-y-title")).toHaveText("younger ← Age lean → older");
      const yTitle = await page.getByTestId("map-y-title").getAttribute("transform");
      expect(yTitle).toMatch(/rotate\(-90\)/); // reads bottom to top: "older" at the top end
      const mean = page.getByTestId("map-mean");
      expect(Number(await mean.getAttribute("data-cx"))).toBeCloseTo(px(rec.deckMean!.female), 6);
      expect(Number(await mean.getAttribute("data-cy"))).toBeCloseTo(py(rec.deckMean!.age), 6);
      await expect(page.getByTestId("map-avg-label")).toHaveText("deck average");
      await expect(page.getByTestId("map-box-label")).toHaveText("± 0.3");
      expect(await page.getByTestId("map-svg").getAttribute("width")).toBe("344");
      expect(await page.getByTestId("map-svg").getAttribute("height")).toBe("314");
    });

    test("map: outlier is the orange square, labels on flagged comps only, no legend, no overlap", async ({ page }) => {
      const rec = recording(id);
      await runSample(page, id);
      await assertMap(page, rec.comps.filter(onMap).map((c) => c.match.matchedTitle ?? c.match.input.title));
      for (const c of rec.comps.filter((c) => c.skewFlag)) {
        const m = page.locator(`[data-testid="map-point"][data-title="${c.match.matchedTitle ?? c.match.input.title}"] [data-testid="map-marker"]`);
        expect(await m.getAttribute("data-shape")).toBe("square");
        expect(await m.getAttribute("width")).toBe("12");
        const st = await m.evaluate((e) => { const s = getComputedStyle(e); return [s.fill, s.stroke, s.strokeWidth]; });
        expect(st).toEqual(["rgb(230, 159, 0)", "rgb(51, 51, 51)", "1.5px"]); // #E69F00 with #333, the logo's orange tile
      }
      for (const c of rec.comps.filter((c) => c.skewSplit)) {
        const p = page.locator(`[data-testid="map-point"][data-title="${c.match.matchedTitle ?? c.match.input.title}"]`);
        await expect(p.getByTestId("map-ring")).toHaveCount(1);
        expect(await p.getByTestId("map-ring").evaluate((e) => getComputedStyle(e).strokeDasharray)).not.toBe("none");
      }
      // The logo's sixth tile is the same orange.
      const logo = await page.request.get(URL! + "/brand/logo-mark.svg");
      expect((await logo.text()).toLowerCase()).toContain("#e69f00");
      await expect(page.getByTestId("map-label")).toHaveCount(rec.comps.filter(onMap).length);
      await assertMapLabels(page);
    });

    test("no scroll at 1280x800: verdict, both status lines, the map, the table header and every row", async ({ page }) => {
      const rec = recording(id);
      await runSample(page, id);
      await expect(page.getByTestId("comp-row")).toHaveCount(rec.comps.length);
      await assertNoScroll(page);
      await expect(page.getByTestId("limits-footer")).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId("recorded-stamp")).toBeInViewport({ ratio: 1 });
    });

    test("status lines and footer copy are unchanged (locked copy)", async ({ page }) => {
      await runSample(page, id);
      await expect(page.getByTestId("calls")).toHaveText("No new Qloo calls.");
      await expect(page.getByTestId("privacy-footer")).toHaveText(PRIVACY_FOOTER);
      await expect(page.getByTestId("status-lines").getByTestId("limits-footer")).toHaveCount(1);
    });

    test("no cue relies on color alone (deuteranopia rule)", async ({ page }) => {
      await runSample(page, id);
      // Verdict audience icon: chip shape differs by kind (solid square vs dashed border) and the line names the kind.
      const aud = page.locator('[data-testid="verdict-line"][data-kind="audience"]');
      const kind = await aud.locator(".v-icon").getAttribute("data-icon-kind");
      if (kind === "outlier-chip") await expect(aud).toContainText("Audience outlier");
      if (kind === "split-chip") { await expect(aud).toContainText("Audience split"); expect(await aud.locator(".v-icon").evaluate((e) => getComputedStyle(e).borderStyle)).toBe("dashed"); }
      // Table flags carry a word and an icon; map flags carry a shape and a word.
      for (const f of await page.locator("table.results .flag").all()) { await expect(f).toHaveText(/\w{3,}/); await expect(f.locator("svg")).toHaveCount(1); }
      for (const p of await page.locator('[data-testid="map-point"]:not([data-flag="none"])').all()) {
        const flag = await p.getAttribute("data-flag");
        await expect(p.getByTestId("map-flag")).toHaveText(flag === "outlier" ? "Audience outlier" : "Audience split");
        if (flag === "outlier") expect(await p.getByTestId("map-marker").getAttribute("data-shape")).toBe("square");
        else await expect(p.getByTestId("map-ring")).toHaveCount(1);
      }
    });

    test("7:11 rule: no clock on the results screen unless it reads 7:11 (WP-N)", async ({ page }) => {
      await runSample(page, id);
      const clocks = (await visibleText(page)).match(/\b\d{1,2}:\d{2}\s?(AM|PM|a\.m\.|p\.m\.)?/gi) ?? [];
      for (const c of clocks) expect(c).toMatch(/^7:11/);
    });
  });

  test.describe(`${id} at 375`, () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("phones: verdict first at 16 px, flagged comps first, Deck order puts them back", async ({ page }) => {
      const rec = recording(id);
      await runSample(page, id);
      for (const l of await page.getByTestId("verdict-line").all()) expect(await l.evaluate((e) => getComputedStyle(e).fontSize)).toBe("16px");
      const v = (await page.getByTestId("verdict").boundingBox())!;
      expect(v.y).toBeLessThan((await page.getByTestId("deck-map").boundingBox())!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
      const order = async () => (await page.getByTestId("comp-row").evaluateAll((rs) => rs.map((r) => ({ t: r.getAttribute("data-title")!, y: r.getBoundingClientRect().top })))).sort((a, b) => a.y - b.y).map((r) => r.t);
      const deck = rec.comps.map((c) => c.match.input.title);
      const want = [...rec.comps.filter(flagged), ...rec.comps.filter((c) => !flagged(c))].map((c) => c.match.input.title);
      expect(rec.comps.some(flagged)).toBe(true);
      expect(await order()).toEqual(want);
      // Each open detail stays under its own card.
      const first = rec.comps.find(flagged)!;
      await page.locator(`[data-testid="comp-row"][data-title="${first.match.input.title}"] .comp-title`).click();
      const det = (await page.locator(`#detail-${first.key}`).boundingBox())!;
      const own = (await page.locator(`[data-testid="comp-row"][data-title="${first.match.input.title}"]`).boundingBox())!;
      expect(det.y).toBeGreaterThanOrEqual(own.y + own.height - 1);
      const next = (await order())[1];
      expect((await page.locator(`[data-testid="comp-row"][data-title="${next}"]`).boundingBox())!.y).toBeGreaterThanOrEqual(det.y + det.height - 1);
      await page.getByTestId("deck-order-toggle").click();
      await expect(page.getByTestId("deck-order-toggle")).toHaveAttribute("aria-pressed", "true");
      expect(await order()).toEqual(deck);
    });

    test("phones: map labels do not overlap, outlier is the orange square", async ({ page }) => {
      const rec = recording(id);
      await runSample(page, id);
      await assertMap(page, rec.comps.filter(onMap).map((c) => c.match.matchedTitle ?? c.match.input.title));
      await expect(page.getByTestId("deck-map")).toBeVisible();
      expect(((await visibleText(page)).match(/qloo['\u2019]s estimate/gi) ?? []).length).toBe(2);
    });
  });
}

test.describe("landing at 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("landing shows before a run and footer text is unchanged", async ({ page }) => {
    await page.goto(URL! + "/");
    await expect(page.locator(".hero")).toHaveCount(1);
    await expect(page.getByTestId("privacy-footer")).toHaveText(PRIVACY_FOOTER);
    await expect(page.getByTestId("limits-footer")).toHaveCount(1);
  });
});
