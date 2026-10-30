/**
 * Design acceptance for the top of page and results mode: frame, verdict, map, status lines, phones.
 * Runs through e2e/run-handoff.sh: a no-key server (QLOO_LIVE=0) on a copy of a recorded store, 0 Qloo calls.
 * Expected values are read from that recording at run time; no step numbers or Qloo values are written here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CANT_REACH, PRIVACY_FOOTER } from "../lib/messages";
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
/** Visible text without the rows' inline reason lines (WP-2): a reason is the comp's own Why line, verbatim, so its
 * "(Qloo's estimate)" is not counted against the two places the page itself says it. */
const textOutsideReasons = (page: Page) => page.evaluate(() => { const els = [...document.querySelectorAll<HTMLElement>(".flag-why")]; els.forEach((e) => (e.style.display = "none")); const t = document.body.innerText; els.forEach((e) => (e.style.display = "")); return t; });

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

    test("\"Qloo's estimate\" appears exactly twice outside the rows' own reasons: the verdict and the map caption", async ({ page }) => {
      await runSample(page, id);
      const text = await textOutsideReasons(page);
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

    test("no scroll at 1280x800: verdict, both status lines, the map, the table header and the first rows", async ({ page }) => {
      const rec = recording(id);
      await runSample(page, id);
      await expect(page.getByTestId("comp-row")).toHaveCount(rec.comps.length);
      // D2 (WP-2 acceptance): Pennywell keeps 5 rows above the fold. Dream Hackers' close-call row also carries a split
      // pill, and each flag has its reason and next step (Oct 30), so 3 of its 5 rows fit.
      await assertNoScroll(page, id === "pennywell" ? 5 : 3);
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
      expect(((await textOutsideReasons(page)).match(/qloo['\u2019]s estimate/gi) ?? []).length).toBe(2);
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

// UX audit WP-1: the printed sheet is one letter page, the map stays right of the verdict, and the print head says
// "Printed" with the sample label once. Width media queries are screen-only, so a 720 px letter page keeps the grid.
test.describe("print sheet (WP-1)", () => {
  const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const states: [string, string][] = [["pennywell", "/?sample=pennywell"], ["dreamhackers", "/?sample=dreamhackers"], ["removed", "/?sample=pennywell&without=Midsommar"]];
  for (const [name, path] of states) {
    test(`${name}: one letter page, map right of the verdict, Rank and lean columns, "Printed" head`, async ({ page }) => {
      await page.goto(URL! + path);
      await waitIdle(page);
      if (name === "removed") await expect(page.getByTestId("undo-remove")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(pages(await page.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true }))).toBe(1);
      // A letter page at 0.5 in margins is 720 CSS px wide: lay out at that width under print media.
      await page.setViewportSize({ width: 720, height: 960 });
      await page.emulateMedia({ media: "print" });
      const v = (await page.getByTestId("verdict").boundingBox())!;
      const m = (await page.getByTestId("deck-map").boundingBox())!;
      expect(m.x).toBeGreaterThan(v.x + v.width);
      for (const h of ["Rank", "Age lean", "Female lean"]) await expect(page.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
      await expect(page.getByTestId("print-head")).toContainText(/^Film Comp Check sheet\. Printed /);
      await expect(page.getByTestId("sample-label")).toBeHidden();
      // The removed row prints as "{Title} Removed", no dangling separator (Oct 30).
      if (name === "removed") expect((await page.getByTestId("removed-row").innerText()).trim()).toMatch(/Removed$/);
      expect(((await page.locator("body").innerText()).match(/Sample run/g) ?? []).length).toBe(1);
      await page.emulateMedia({ media: "screen" });
    });
  }
});

// UX audit WP-4: no horizontal scroll at 320 on the landing and the result; Export and Edit comps stay inside.
test.describe("320 px (WP-4)", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("landing and Pennywell result: scrollWidth <= 320, header actions inside the viewport", async ({ page }) => {
    await page.goto(URL! + "/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await runSample(page, "pennywell");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expect(page.getByTestId("appbar").getByRole("link", { name: "Film Comp Check" })).toBeVisible();
    for (const el of [page.getByTestId("export-menu").locator("summary"), page.getByTestId("appbar").getByRole("button", { name: "Edit comps" })]) {
      const b = (await el.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(320);
    }
    await expect(page.getByTestId("export-menu").locator("summary")).toContainText("Export");
  });
});

// UX audit WP-7 steps 1-3: DS buttons, flat panels, tokens instead of raw values.
test.describe("design system buttons and panels (WP-7)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("buttons weigh 600, primary hover and disabled follow the tokens, Edit comps is ghost", async ({ page }) => {
    await runSample(page, "pennywell");
    const token = (name: string) => page.evaluate((n) => { const d = document.createElement("div"); d.style.background = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }, name);
    for (const b of await page.locator("button.btn:not(.link)").all()) expect(await b.evaluate((e) => getComputedStyle(e).fontWeight)).toBe("600");
    const edit = page.getByTestId("appbar").getByRole("button", { name: "Edit comps" });
    await expect(edit).toHaveClass(/ghost/);
    const probe = async (cls: string, disabled: boolean, hover: boolean) => {
      await page.evaluate(([c, d]) => { const b = document.createElement("button"); b.className = c as string; b.id = "probe"; b.textContent = "Probe"; b.disabled = d as boolean; b.style.position = "fixed"; b.style.top = "300px"; b.style.left = "300px"; b.style.transition = "none"; document.body.append(b); }, [cls, disabled]);
      if (hover) await page.locator("#probe").hover({ force: true });
      const bg = await page.locator("#probe").evaluate((e) => getComputedStyle(e).backgroundColor);
      await page.evaluate(() => document.getElementById("probe")?.remove());
      return bg;
    };
    expect(await probe("btn primary", false, true)).toBe(await token("--action-primary-hover"));
    expect(await probe("btn primary", true, false)).toBe(await token("--gray-100"));
  });
  test("a run error is a flat panel with a heavy top rule and no left border", async ({ page }) => {
    await page.route("**/api/check**", (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", error: "Something went wrong." }) + "\n" }));
    await page.goto(URL! + "/");
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    const panel = page.getByTestId("error-state");
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("none");
    expect(await panel.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("2px");
    await expect(page.getByTestId("check-failed")).toHaveText("Check failed.");
  });
});

// UX audit WP-2: DS flag pills with their own reason inline, MatchBadge, "— " for no flags, a worded Remove, Why ↓.
test.describe("results table (WP-2)", () => {
  const token = (page: Page, name: string) => page.evaluate((n) => { const d = document.createElement("div"); d.style.background = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }, name);
  const flagRow = (page: Page, title: string) => page.locator(`[data-testid=comp-row][data-title="${title}"]`);

  test("1280: pills with one reason line each, — on unflagged rows, close call is outlined with circleHelp, Why ↓ opens the detail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const rec = recording("pennywell") as Rec & { comps: (Comp & { key: string; reasons: string[]; cutLabel?: string; match: { input: { title: string; year?: number } } })[] };
    await runSample(page, "pennywell");
    for (const c of rec.comps) {
      const r = flagRow(page, c.match.input.title);
      if (flagged(c)) {
        await expect(r.locator(".flag-item .flag")).not.toHaveCount(0);
        await expect(r.getByTestId("flag-why").first()).toBeVisible();
        const first = (await r.getByTestId("flag-why").first().textContent())!;
        expect(c.reasons.some((x) => x.toLowerCase().includes(first.slice(0, 30).toLowerCase()))).toBe(true);
      } else await expect(r.locator(".flags-cell")).toHaveText(/^—\s*No flags$/);
      // Accessible name keeps a space between title and year.
      if (c.match.input.year) await expect(r.getByTestId("comp-toggle")).toHaveAccessibleName(`${c.match.input.title} ${c.match.input.year}`);
    }
    const close = page.locator(".flag.close").first();
    if (await close.count()) {
      expect(await close.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await token(page, "--white"));
      expect(await close.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe(await token(page, "--gray-600"));
      await expect(close.locator("[data-icon=circleHelp]")).toHaveCount(1);
      await expect(page.locator('[data-testid="verdict-line"][data-kind="fit"] [data-icon=circleHelp]')).toHaveCount(1);
    }
    // Remove reads as an action at 1280 and keeps its name.
    const t = rec.comps[0].match.input.title;
    await expect(page.getByRole("button", { name: `Remove ${t}` })).toContainText("Remove");
    // Why ↓ opens the row's detail and focuses its first Why line.
    const fr = page.locator('[data-testid=comp-row][data-flagged="yes"]').first();
    const key = (await fr.getAttribute("data-key"))!;
    const why = fr.getByTestId("why-link");
    await expect(why).toHaveAttribute("aria-controls", `detail-${key}`);
    await expect(why).toHaveAttribute("aria-expanded", "false");
    await why.click();
    await expect(page.locator(`#detail-${key}`)).toBeVisible();
    await expect(why).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`#why-${key}-0`)).toBeFocused();
    // Rank merges under the score; the header names both.
    await expect(page.getByRole("columnheader", { name: "Fit · rank" })).toBeVisible();
  });

  test("removed Midsommar: the cut pill is filled orange with its reason line; Remove is worded at 375", async ({ page }) => {
    await page.goto(URL! + "/?sample=pennywell&without=Midsommar");
    await waitIdle(page);
    await expect(page.getByTestId("undo-remove")).toBeVisible();
    const cut = page.locator(".flag.cut").first();
    await expect(cut).toBeVisible();
    expect(await cut.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await token(page, "--orange-500"));
    await expect(cut.locator("xpath=..").getByTestId("flag-why")).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    const rm = page.locator("button.rm").first();
    await expect(rm).toContainText("Remove");
    const b = (await rm.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
  });

  test("landing aside: the close call line uses circleHelp", async ({ page }) => {
    await page.goto(URL! + "/");
    const fit = page.getByTestId("sample-verdict-line").filter({ hasText: /close call/ });
    if (await fit.count()) await expect(fit.locator("[data-icon=circleHelp]")).toHaveCount(1);
    await expect(page.locator("[data-testid=sample-verdict] [data-icon=approx]")).toHaveCount(0);
  });
});

// UX audit WP-3: the 10-second test. One h1 (the purpose), how it works names Qloo and Claude, the box starts empty.
test.describe("landing (WP-3)", () => {
  test("1280: empty box, one h1, how it works, both samples and the aside above the fold; links work", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(URL! + "/");
    await expect(page.locator("#comps")).toHaveValue("");
    expect((await page.locator("#comps").getAttribute("placeholder"))!.split("\n")).toHaveLength(3);
    await expect(page.getByTestId("comp-count")).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveAttribute("data-testid", "purpose");
    await expect(page.getByRole("list", { name: "How it works" }).getByRole("listitem")).toHaveCount(3);
    for (const l of [page.locator("h1"), page.getByTestId("how"), page.getByRole("button", { name: "Try the Pennywell sample" }), page.getByTestId("sample-dreamhackers"), page.getByTestId("sample-verdict")]) await expect(l).toBeInViewport({ ratio: 1 });
    const fold = await page.evaluate(() => { const r = document.createRange(); r.setStart(document.body, 0); r.setEnd(document.querySelector('[data-testid="sample-verdict"]')!, 0); return r.toString(); });
    expect(fold).toContain("Qloo");
    expect(fold).toContain("Claude");
    await page.getByTestId("own-comps").click();
    await expect(page.locator("#comps")).toBeFocused();
    await page.getByTestId("see-full-result").click();
    await waitIdle(page);
    await expect(page.getByTestId("deckchip")).toHaveText(/^Pennywell sample/);
  });
  test("375: h1, how it works and both sample buttons above the fold", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(URL! + "/");
    for (const l of [page.locator("h1"), page.getByTestId("how"), page.getByRole("button", { name: "Try the Pennywell sample" }), page.getByTestId("sample-dreamhackers")]) await expect(l).toBeInViewport({ ratio: 1 });
  });
});

// UX audit WP-5: what changed after a Remove is visible, and Undo puts it all back.
test.describe("Remove/Undo change (WP-5)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("removed Midsommar: bold summary, was lines from the recording, kept removed row, chip 5 of 6; Undo clears them", async ({ page }) => {
    const rec = recording("pennywell") as unknown as { comps: { match: { input: { title: string } }; fit?: { affinity?: number }; considerCutting?: boolean; cutLabel?: string; skewFlag?: unknown; skewSplit?: unknown }[] };
    await page.goto(URL! + "/?sample=pennywell&without=Midsommar");
    await waitIdle(page);
    await expect(page.getByTestId("undo-remove")).toBeVisible();
    expect(await page.getByTestId("change-summary-text").evaluate((e) => getComputedStyle(e).fontWeight)).toBe("600");
    await expect(page.getByTestId("deckchip")).toHaveText("Pennywell sample · 5 of 6 comps");
    // Every "was" score is the recorded full-deck score of that row, to 3 decimals; flag lines name the earlier label.
    for (const w of await page.getByTestId("was-score").all()) {
      const title = await w.locator("xpath=ancestor::tr").getAttribute("data-title");
      const c = rec.comps.find((x) => x.match.input.title === title)!;
      await expect(w).toHaveText(`was ${c.fit!.affinity!.toFixed(3)}`);
    }
    const closeCall = rec.comps.find((c) => c.considerCutting && c.cutLabel === "Lowest fit, close call");
    if (closeCall) {
      const r = page.locator(`[data-testid=comp-row][data-title="${closeCall.match.input.title}"]`);
      await expect(r.getByTestId("was-score")).toHaveCount(1);
      await expect(r.getByTestId("was-flag")).toHaveText(/^was Lowest fit, close call/);
    }
    const rows = page.locator("table.results tbody > tr:not(.detail)");
    await expect(rows.last()).toHaveAttribute("data-testid", "removed-row");
    await expect(rows.last()).toContainText("Midsommar");
    await expect(rows.last()).toContainText("Removed");
    await page.getByTestId("removed-row-undo").click();
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(rec.comps.length);
    expect(await page.getByTestId("comp-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-title")))).toEqual(rec.comps.map((c) => c.match.input.title));
    for (const c of rec.comps) await expect(page.locator(`[data-testid=comp-row][data-title="${c.match.input.title}"] [data-testid=score]`)).toHaveAttribute("data-score", c.fit!.affinity!.toFixed(6));
    await expect(page.getByTestId("removed-row")).toHaveCount(0);
    await expect(page.locator(".was")).toHaveCount(0);
    await expect(page.getByTestId("deckchip")).toHaveText("Pennywell sample · 6 comps");
  });
  test("reduced motion: no wash animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(URL! + "/?sample=pennywell&without=Midsommar");
    await waitIdle(page);
    await expect(page.getByTestId("undo-remove")).toBeVisible();
    const changed = page.locator(".changed").first();
    if (await changed.count()) expect(await changed.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  });
});

// UX audit WP-9: phone rows, not cards.
test.describe("phone rows (WP-9)", () => {
  test("375x812: six Pennywell rows within 700 px, Remove 44x44 and worded, flagged first; no sideways scroll 320-720", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const rec = recording("pennywell");
    await runSample(page, "pennywell");
    const hs = await page.getByTestId("comp-row").evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().height));
    expect(hs).toHaveLength(rec.comps.length);
    expect(hs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(700);
    for (const rm of await page.locator("button.rm").all()) { const b = (await rm.boundingBox())!; expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44); await expect(rm).toContainText("Remove"); }
    const firstTitle = await page.getByTestId("comp-row").evaluateAll((rs) => rs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0].getAttribute("data-title"));
    expect(firstTitle).toBe(rec.comps.find(flagged)!.match.input.title);
    expect(await page.locator("table.results").evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("2px");
    for (const w of [320, 414, 600, 720]) {
      await page.setViewportSize({ width: w, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    }
  });
  test("900: status lines and map side by side under the verdict (6.4)", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await runSample(page, "pennywell");
    const v = (await page.getByTestId("verdict").boundingBox())!, s = (await page.getByTestId("status-lines").boundingBox())!, m = (await page.getByTestId("deck-map").boundingBox())!;
    expect(m.y).toBeGreaterThan(v.y + v.height - 1);
    expect(m.x).toBeGreaterThan(s.x + s.width - 1);
    expect(Math.abs(m.y - s.y)).toBeLessThan(40);
  });
});

// UX audit WP-6: trust and provenance.
test.describe("trust and provenance (WP-6)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("sample loading line, How these numbers are made, one agent name, the stamp's step count opens the log", async ({ page }) => {
    await page.goto(URL! + "/");
    await page.route("**/api/check**", async (r) => { await new Promise((res) => setTimeout(res, 400)); await r.continue(); });
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await expect(page.getByTestId("loading-state")).toContainText("No new Qloo calls");
    await waitIdle(page);
    const how = page.getByTestId("how-numbers");
    await expect(how).toHaveCount(1);
    expect(await how.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await expect(how).toContainText("checked against a tool result");
    await expect(how).toContainText("more than 0.3 from the deck average"); // lib/skew.ts SKEW_THRESHOLD
    await page.emulateMedia({ media: "print" });
    await expect(how.locator("li").first()).toBeVisible(); // printed open on the sheet
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByTestId("chose-count")).toContainText("Claude chose");
    await expect(page.getByTestId("recorded-stamp")).toContainText("Claude chose");
    const link = page.getByTestId("stamp-steps");
    await link.click();
    await expect(page.locator("#steps-panel")).toBeVisible();
    const first = await page.getByTestId("chosen-steps").locator("li[data-n]").first().getAttribute("data-n");
    await expect(page.locator(`#step-${first}`)).toBeFocused();
  });
});

// UX audit WP-10: semantics. One live region per run step, a keyboard menu, the error-only page's h1, the tab title.
test.describe("accessibility semantics (WP-10)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("live regions, Export menu arrows, document.title", async ({ page }) => {
    await page.goto(URL! + "/");
    await expect(page).toHaveTitle("Film Comp Check");
    await page.route("**/api/check**", async (r) => { await new Promise((res) => setTimeout(res, 300)); await r.continue(); });
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await expect(page.getByTestId("live-status")).toBeVisible();
    const live = await page.evaluate(() => document.querySelectorAll('[role="status"]:not(:empty), [aria-live]:not([aria-live="off"])').length);
    expect(live).toBeLessThanOrEqual(2); // live-status, plus the draft line's (empty) status at most
    await expect(page.getByTestId("status-lines")).not.toHaveAttribute("role", /.+/);
    await expect(page.getByTestId("verdict")).not.toHaveAttribute("aria-live", /.+/);
    await waitIdle(page);
    await expect(page).toHaveTitle("Pennywell sample · 6 comps · Film Comp Check");
    const summary = page.getByTestId("export-menu").locator("summary");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    const items = page.getByRole("menuitem");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    for (const bar of await page.getByTestId("bar").all()) await expect(bar).toHaveAttribute("role", "img");
  });
  test("an error with no result: the headline is the page's h1 and takes focus", async ({ page }) => {
    await page.route("**/api/check**", (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", error: "Something went wrong." }) + "\n" }));
    await page.goto(URL! + "/");
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("error-headline")).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("data-testid", "error-headline");
  });
});

// UX audit WP-11: states and errors.
test.describe("states and errors (WP-11)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const liveOn = (page: Page) => page.route((u) => u.pathname === "/", async (r) => {
    const res = await r.fetch();
    await r.fulfill({ response: res, body: (await res.text()).replace(/(\\?"qlooLive\\?":)false/g, "$1true") });
  });
  test("offline: a sample click says You're offline, no Failed to fetch", async ({ page, context }) => {
    await page.goto(URL! + "/");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await expect(page.getByTestId("error-headline")).toHaveText("You're offline");
    await expect(page.locator("body")).not.toContainText("Failed to fetch");
    await expect(page.getByTestId("error-detail")).toHaveCount(0);
    await context.setOffline(false);
  });
  test("a first-run Qloo error on a custom deck keeps the box, with the deck, under the error", async ({ page }) => {
    await liveOn(page);
    await page.route("**/api/check**", (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", error: CANT_REACH }) + "\n" }));
    await page.goto(URL! + "/");
    const deck = "Alpha Film | 2001\nBeta Film | 2002\nGamma Film | 2003";
    await page.locator("#comps").fill(deck);
    await page.getByRole("button", { name: "Check comps" }).click();
    await expect(page.getByTestId("error-state")).toHaveAttribute("data-kind", "qloo");
    await expect(page.locator("#comps")).toHaveValue(deck);
    const e = (await page.getByTestId("error-state").boundingBox())!, b = (await page.locator("#comps").boundingBox())!;
    expect(b.y).toBeGreaterThan(e.y);
  });
  test("shared custom deck: the shared-deck line; Stop on a cold run: Check stopped", async ({ page }) => {
    await page.goto(URL! + "/?c=Alpha+Film&c=Beta+Film&c=Gamma+Film");
    await expect(page.getByTestId("shared-line")).toHaveText("Shared deck: 3 comps. Check comps runs them live on Qloo.");
    await page.locator("#comps").fill("Alpha Film");
    await expect(page.getByTestId("shared-line")).toHaveCount(0);
    await page.goto(URL! + "/");
    await page.route(/\/api\/check/, () => { /* held until Stop */ });
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await page.getByTestId("stop").click();
    await expect(page.getByTestId("stopped-line")).toHaveText("Check stopped. Nothing was scored.");
    await page.locator("#comps").fill("Something else");
    await expect(page.getByTestId("stopped-line")).toHaveText("");
  });
  test("a failed Remove offers no Dream Hackers button", async ({ page }) => {
    await runSample(page, "pennywell");
    await page.route("**/api/check**", (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", error: CANT_REACH }) + "\n" }));
    await page.getByRole("button", { name: "Remove Midsommar" }).click();
    await expect(page.getByTestId("error-state")).toHaveAttribute("data-kind", "remove");
    await expect(page.getByTestId("error-sample-dreamhackers")).toHaveCount(0);
  });
});

// UX audit WP-13: copy consistency and export labels.
test.describe("copy and export labels (WP-13)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("menu items with 4 icons; dated, named downloads; Run again notes no new Qloo calls", async ({ page }) => {
    await runSample(page, "pennywell");
    await page.getByTestId("export-menu").locator("summary").click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText([/Print one-page sheet/, /Download Markdown \(\.md\)/, /Download CSV \(\.csv\)/, /Copy share link/]);
    for (const i of await items.all()) await expect(i.locator("svg")).toHaveCount(1);
    for (const [label, ext] of [["Download Markdown (.md)", "md"], ["Download CSV (.csv)", "csv"]] as const) {
      await page.getByTestId("export-menu").evaluate((d) => { (d as HTMLDetailsElement).open = true; });
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
      expect(dl.suggestedFilename()).toMatch(new RegExp(`^film-comp-check-pennywell-\\d{4}-\\d{2}-\\d{2}\\.${ext}$`));
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("replay-again")).toHaveText("Run again");
    await expect(page.getByTestId("replay-again")).not.toHaveAttribute("title", /.+/);
    await expect(page.getByTestId("replay-again-note")).toHaveCount(0); // dropped Oct 30: the line already says "No new Qloo calls."
    await expect(page.getByTestId("legend")).toContainText("the rest of your comps");
  });
});

// UX audit WP-12: the comps box.
test.describe("comps input (WP-12)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("count with limits, comma hint, bulleted paste, textarea attributes, shortcut hint, live-checks note", async ({ page }) => {
    await page.route((u) => u.pathname === "/", async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, body: (await res.text()).replace(/(\\?"qlooLive\\?":)false/g, "$1true") });
    });
    await page.goto(URL! + "/");
    const box = page.locator("#comps");
    for (const [a, v] of [["autocorrect", "off"], ["autocapitalize", "off"], ["autocomplete", "off"], ["enterkeyhint", "enter"]]) await expect(box).toHaveAttribute(a, v);
    await expect(page.getByTestId("input-hint")).toContainText("Press ⌘ Enter or Ctrl Enter to check.");
    await expect(page.getByTestId("live-checks")).toHaveText(/^Live checks: \d+ per visitor per day\.$/);
    await box.fill(Array.from({ length: 12 }, (_, i) => `Film ${i + 1}`).join("\n"));
    await expect(page.getByTestId("comp-count")).toHaveText("12 comps (10 max)");
    await box.fill("- Alpha Film\n• Beta Film\n1. Gamma Film");
    await expect(page.getByTestId("comp-count")).toHaveText("3 comps");
    await box.fill("Alpha, Beta, Gamma");
    await page.getByRole("button", { name: "Check comps" }).click();
    await expect(page.getByTestId("field-error")).toContainText("Titles can contain commas, so commas don't split them.");
  });
});

// UX audit WP-7 steps 4-6: top-region gap, DS step log, spinning loader.
test.describe("step log, top region, loader (WP-7)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("step lines in 12 px Plex Mono; status rule 24 px under the verdict; the loader spins", async ({ page }) => {
    await page.goto(URL! + "/");
    await page.route("**/api/check**", async (r) => { await new Promise((res) => setTimeout(res, 400)); await r.continue(); });
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    expect(await page.locator(".loading-line .icon").evaluate((e) => getComputedStyle(e).animationName)).toBe("fcc-spin");
    await waitIdle(page);
    await page.getByTestId("steps-toggle").click();
    const li = page.getByTestId("chosen-steps").locator("li[data-n]").first();
    expect(await li.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/IBM Plex Mono/);
    expect(await li.evaluate((e) => getComputedStyle(e).fontSize)).toBe("12px");
    expect(await li.evaluate((e) => getComputedStyle(e, "::before").content)).toMatch(/^"\d{2,}"$/);
    const v = (await page.getByTestId("verdict").boundingBox())!, s = (await page.getByTestId("status-lines").boundingBox())!;
    expect(Math.round(s.y - (v.y + v.height))).toBe(24);
  });
});

// UX audit WP-8: deck map caption, row ↔ point link, long labels.
test.describe("deck map (WP-8)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("caption; hovering a row rings and labels its point; a row's toggle describes its point", async ({ page }) => {
    const rec = recording("pennywell") as Rec & { comps: (Comp & { key: string })[] };
    await runSample(page, "pennywell");
    await expect(page.getByTestId("map-key")).toHaveText("Dashed box: within 0.3 of the deck average."); // SKEW_THRESHOLD
    const plain = rec.comps.find((c) => !onMap(c) && c.skew)!;
    const t = plain.match.input.title;
    await page.locator(`[data-testid=comp-row][data-title="${t}"]`).hover();
    const pt = page.locator(`[data-testid=map-point][data-key="${plain.key}"]`);
    await expect(pt.getByTestId("map-hover-ring")).toHaveCount(1);
    await expect(pt.getByTestId("map-label")).toHaveText(t.length > 18 ? /…$/ : t);
    await expect(page.locator(`[data-testid=comp-row][data-title="${t}"]`)).toHaveClass(/hovered/);
    await page.mouse.move(5, 5);
    await expect(pt.getByTestId("map-label")).toHaveCount(0);
    const desc = await page.locator(`[data-testid=comp-row][data-title="${t}"] [data-testid=comp-toggle]`).getAttribute("aria-describedby");
    await expect(page.locator(`#${desc}`)).toHaveText(/^On the audience map: sits (above|below) the deck average, more (fe)?male\.$/);
  });
  test("10 comps with 60-90 character titles: every label stays inside the SVG", async ({ page }) => {
    const rec = JSON.parse(readFileSync(join(STORE!, createHash("sha256").update("sample:replay:pennywell").digest("hex") + ".json"), "utf8")).v.result;
    const long = (i: number) => `An Exceptionally Long Working Title For Comp Number ${i} That Keeps Going${"!".repeat(i)}`;
    const comps = Array.from({ length: 10 }, (_, i) => {
      const c = structuredClone(rec.comps[i % rec.comps.length]);
      c.key = `long${i}`; c.match.input.title = long(i); c.match.matchedTitle = long(i);
      c.skew = { ...c.skew, female: Math.max(-0.95, Math.min(0.95, c.skew.female + (i % 2 ? 0.6 : -0.6))), age: Math.max(-0.95, Math.min(0.95, c.skew.age + (i % 3 ? 0.5 : -0.5))) };
      c.skewFlag = undefined; c.skewSplit = i < 3 ? { flagged: true } : undefined;
      return c;
    });
    const result = { ...rec, comps };
    await page.route("**/api/check**", (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "result", result }) + "\n" }));
    await page.goto(URL! + "/");
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    const svg = (await page.getByTestId("map-svg").boundingBox())!;
    const groups = page.getByTestId("map-label-group");
    expect(await groups.count()).toBeGreaterThan(0);
    for (const g of await groups.all()) {
      const b = (await g.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(svg.x - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(svg.x + svg.width + 0.5);
    }
    for (const l of await page.getByTestId("map-label").allTextContents()) expect(l.length).toBeLessThanOrEqual(19);
  });
});

// UX audit WP-14: Back from a result goes to the landing on this site; Forward replays the sample.
test.describe("browser history (WP-14)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("landing → sample → Back shows the landing; Forward replays; share URLs unchanged", async ({ page }) => {
    await page.goto(URL! + "/");
    await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
    await waitIdle(page);
    expect(new globalThis.URL(page.url()).searchParams.getAll("c").length).toBe(6);
    await page.goBack();
    await expect(page.locator(".hero")).toBeVisible();
    expect(new globalThis.URL(page.url()).origin).toBe(new globalThis.URL(URL!).origin);
    expect(new globalThis.URL(page.url()).search).toBe("");
    await expect(page).toHaveTitle("Film Comp Check");
    await page.goForward();
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(6);
    await page.reload();
    await waitIdle(page);
    await expect(page.getByTestId("comp-row")).toHaveCount(6);
  });
});

// UX audit WP-15: WOFF2 subsets, long cache, og image still renders.
test.describe("fonts (WP-15)", () => {
  test("first-load font bytes <= 350 KB (WOFF2 only); /fonts is cached immutable; /og.png renders", async ({ page }) => {
    const fonts: { url: string; bytes: number }[] = [];
    page.on("response", async (r) => { if (r.request().resourceType() === "font") fonts.push({ url: r.url(), bytes: (await r.body().catch(() => Buffer.alloc(0))).length }); });
    await runSample(page, "pennywell");
    await page.getByTestId("steps-toggle").click();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(f.url).toMatch(/\.woff2$/);
    expect(fonts.reduce((a, f) => a + f.bytes, 0)).toBeLessThanOrEqual(350 * 1024);
    const r = await page.request.get(URL! + "/fonts/Inter-Variable.woff2");
    expect(r.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    const og = await page.request.get(URL! + "/og.png");
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toBe("image/png");
  });
});

// Oct 30 wrap-up, item 1: the score scale under the table; "all close" only when every shown gap is within 0.02.
test.describe("score scale (Oct 30)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("the scale line always; the all-close line follows the shown gaps", async ({ page }) => {
    for (const path of ["/?sample=pennywell", "/?sample=pennywell&without=Midsommar", "/?sample=dreamhackers"]) {
      await page.goto(URL! + path);
      await waitIdle(page);
      if (path.includes("without")) await expect(page.getByTestId("undo-remove")).toBeVisible();
      await expect(page.getByTestId("score-scale")).toContainText("Scores run from 0 to 1. Higher means the comp's audience matches your film's more closely.");
      const gaps = (await page.getByTestId("rank").allTextContents()).map((t) => t.match(/(\d\.\d{3}) below next/)?.[1]).filter(Boolean).map(Number);
      await expect(page.getByTestId("score-scale-close")).toHaveCount(gaps.every((g) => g <= 0.02) ? 1 : 0);
    }
  });
});

// Oct 30 wrap-up, item 2: each flag says what to do next, in place of a bare "Check it." (the verdict keeps its text).
test.describe("next step per flag (Oct 30)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("outlier and lowest-fit rows carry the approved lines; no bare Check it. under a flag", async ({ page }) => {
    await runSample(page, "pennywell");
    await expect(page.locator(".flag-item:has(.flag.skew) [data-testid=flag-next]")).toContainText("Keep it if you can explain the gap to investors, or swap in a comp closer to your audience.");
    await expect(page.locator(".flag-item:has(.flag.close) [data-testid=flag-next]")).toContainText("This is the comp investors will question first. Be ready to defend it, or try cutting it.");
    for (const w of await page.getByTestId("flag-why").allTextContents()) expect(w).not.toMatch(/Check it\.\s*$/);
    await expect(page.locator('[data-testid="verdict-line"][data-kind="audience"]')).toContainText("Check it.");
    await page.goto(URL! + "/?sample=pennywell&without=Midsommar");
    await waitIdle(page);
    await expect(page.locator(".flag-item:has(.flag.cut) [data-testid=flag-next]")).toContainText("This is the comp investors will question first.");
  });
});

// Oct 30 wrap-up, item 5: step tags say Claude; real minus signs in the bar caption; the Wikipedia line says why.
test.describe("wording fixes (Oct 30)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("Claude chose tags, U+2212 in the caption, the views line", async ({ page }) => {
    await runSample(page, "pennywell");
    await page.getByTestId("steps-toggle").click();
    await expect(page.getByTestId("chosen-steps").getByTestId("origin").first()).toHaveText("Claude chose");
    await expect(page.locator("body")).not.toContainText("Model chose");
    for (const r of await page.getByTestId("comp-toggle").all()) await r.click();
    const caps = await page.locator("[data-testid=bars] p").allTextContents();
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) expect(c).not.toMatch(/(^|[\s,;])-\d/);
    expect(caps.join(" ")).toMatch(/−\d/);
    const views = (await page.getByTestId("popularity").allTextContents()).filter(Boolean);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) expect(v).toMatch(/^Context only: [\d,]+ Wikipedia views, a rough sign of how well known this title is\.$/);
  });
});
