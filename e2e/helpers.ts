import { expect, type Page } from "@playwright/test";

export const row = (page: Page, title: string) => page.locator(`[data-testid="comp-row"][data-title="${title}"]`);
/** The comp's detail (Why lines, audience bars, popularity), a disclosure row under the comp row. */
export const detail = (page: Page, title: string) => page.locator(`[data-testid="comp-detail"][data-title="${title}"]`);
export async function waitIdle(page: Page) {
  await expect(page.getByTestId("busy")).toHaveCount(0);
  await expect(page.locator('[data-testid="results"], [data-testid="error-state"], [data-testid="field-error"]').first()).toBeVisible();
}
export async function openExport(page: Page) { await page.getByTestId("export-menu").evaluate((d) => { (d as HTMLDetailsElement).open = true; }); }
export async function editComps(page: Page) {
  if (!(await page.locator("#comps").isVisible())) await page.getByTestId("appbar").getByRole("button", { name: "Edit comps" }).click();
  await expect(page.locator("#comps")).toBeVisible();
}

/** Every tag note's marker names a step N that exists, added a note to that same comp, and has the same origin label. */
export async function assertNoteMarkers(p: Page) {
  if (await p.getByTestId("steps-toggle").count()) await openSteps(p);
  const markers = p.getByTestId("note-marker");
  const n = await markers.count();
  for (let i = 0; i < n; i++) {
    const m = markers.nth(i);
    const step = await m.getAttribute("data-step");
    const key = await m.locator("xpath=ancestor::tr").getAttribute("data-key");
    const li = p.locator(`[data-testid="steps"] li[data-n="${step}"]`);
    await expect(li).toHaveCount(1);
    expect(await li.getAttribute("data-note-comp")).toBe(key);
    const originText = (await li.getByTestId("origin").innerText()).trim();
    expect((await m.textContent())!.trim()).toBe(`${originText} \u00b7 step ${step} \u2193`);
    expect(await m.getAttribute("href")).toBe(`#step-${step}`);
  }
  await expect(p.locator("body")).not.toContainText("no model response");
}

/**
 * Deck map checks: square plot, box half-width equals SKEW_THRESHOLD on the -1..1 scale, every point
 * labeled with its comp name, flagged points carry a word, and the points outside the box are exactly
 * the flagged comps (outlier or split rows in the table).
 */
export async function assertMap(page: Page, expectOutside?: string[]) {
  const map = page.getByTestId("deck-map");
  await expect(map).toBeVisible();
  const plot = (await page.getByTestId("map-plot").boundingBox())!;
  expect(Math.abs(plot.width - plot.height)).toBeLessThanOrEqual(1); // square: equal scales
  const boxEl = page.getByTestId("map-box");
  const box = (await boxEl.boundingBox())!;
  const threshold = Number(await boxEl.getAttribute("data-threshold"));
  expect(threshold).toBe(0.3); // lib/skew.ts SKEW_THRESHOLD
  // Axis spans 2.0 units over the plot width, so the half-width in units is (box width / 2) / (plot width / 2).
  // Geometry from the SVG attributes (bounding boxes include the stroke); rendered size within 1px too.
  const pw = Number(await page.getByTestId("map-plot").getAttribute("width")), ph = Number(await page.getByTestId("map-plot").getAttribute("height"));
  expect(pw).toBe(ph);
  expect(Math.abs(Number(await boxEl.getAttribute("width")) / 2 / (pw / 2) - threshold)).toBeLessThan(1e-9);
  expect(Math.abs(Number(await boxEl.getAttribute("height")) / 2 / (ph / 2) - threshold)).toBeLessThan(1e-9);
  expect(Math.abs((box.width - 1.5) - threshold * (plot.width - 1))).toBeLessThanOrEqual(1);
  const bx = Number(await boxEl.getAttribute("x")), by = Number(await boxEl.getAttribute("y")), bw = Number(await boxEl.getAttribute("width")), bh = Number(await boxEl.getAttribute("height"));
  const outside: string[] = [];
  // UX audit WP-8: more than 4 flagged points get no labels at rest (hover or focus labels one).
  const restLabels = (await page.locator('[data-testid="map-point"]:not([data-flag="none"])').count()) <= 4;
  for (const p of await page.getByTestId("map-point").all()) {
    const t = (await p.getAttribute("data-title"))!;
    const cx = Number(await p.getAttribute("data-cx")), cy = Number(await p.getAttribute("data-cy"));
    if (cx < bx || cx > bx + bw || cy < by || cy > by + bh) outside.push(t);
    const flag = await p.getAttribute("data-flag");
    // Design spec, map: labels for flagged comps only (name, then the flag word); unflagged comps are named by <title>.
    if (flag !== "none" && !restLabels) {
      await expect(p.getByTestId("map-label")).toHaveCount(0);
      await expect(p.locator("title")).toContainText(t);
    } else if (flag !== "none") {
      await expect(p.getByTestId("map-label")).toHaveText(t);
      await expect(p.getByTestId("map-flag")).toHaveText(flag === "outlier" ? "Audience outlier" : "Audience split");
    } else {
      await expect(p.getByTestId("map-label")).toHaveCount(0);
      await expect(p.locator("title")).toHaveText(t);
    }
  }
  if (expectOutside) expect(outside.sort()).toEqual([...expectOutside].sort());
  const flaggedRows = await page.locator('[data-testid="comp-row"]:has(.flag.skew, .flag.split)').evaluateAll((els) => els.map((e) => e.getAttribute("data-title")));
  expect(outside.sort()).toEqual((flaggedRows as string[]).sort());
  await expect(page.getByTestId("map-caption")).toHaveText("Audience lean · Qloo's estimate");
  await expect(page.getByTestId("map-legend")).toHaveCount(0); // no legend: labels and words carry the meaning
  await expect(map).toContainText("Age lean");
  await expect(map).toContainText("Female lean");
  await assertMapLabels(page);
}

/** Design spec, frame: at 1280x800, scrollY 0, the verdict, both status lines, the whole map, the table header and every row are fully on screen. */
export async function assertNoScroll(page: Page, rows = 5) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId("verdict")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("status-lines")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("deck-map")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("table.results thead")).toBeInViewport({ ratio: 1 });
  // UX audit D2: flagged rows carry their reason inline, so the first `rows` rows (5 on Pennywell, not every row) sit
  // above the fold.
  for (const r of (await page.getByTestId("comp-row").all()).slice(0, rows)) {
    const b = (await r.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(800);
  }
}

/** Renamed audience wording on screen, and no percent sign anywhere visible. */
export async function assertRenames(page: Page) {
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/female share|age score|Age, older|%/i);
  expect(body).toMatch(/age lean/i);
  expect(body).toMatch(/female lean/i);
}

type Box = { x: number; y: number; width: number; height: number };
const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width)), Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height)));
const toCenter = (a: Box, px: number, py: number) => Math.hypot(Math.max(0, a.x - px, px - (a.x + a.width)), Math.max(0, a.y - py, py - (a.y + a.height)));
const overlap = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;

/**
 * Map label placement (rendered boxes): no two labels or tags overlap; every label and tag sits within 6px of
 * its own marker, inside the plot, with no leader lines; and the nearest marker to each label and tag
 * (label box edge to marker center) is its own, by a clear margin over every other point.
 */
export async function assertMapLabels(page: Page, log?: string[]) {
  const plot = (await page.getByTestId("map-plot").boundingBox())!;
  const pts: { title: string; marker: Box; cx: number; cy: number; boxes: { kind: string; box: Box }[] }[] = [];
  for (const p of await page.getByTestId("map-point").all()) {
    // A split comp's mark is its dot plus the dashed ring around it, so the ring is the marker edge.
    const marker = (await ((await p.getByTestId("map-ring").count()) ? p.getByTestId("map-ring") : p.getByTestId("map-marker")).boundingBox())!;
    if (!(await p.getByTestId("map-label").count())) { const marker = (await p.getByTestId("map-marker").boundingBox())!; pts.push({ title: (await p.getAttribute("data-title"))!, marker, cx: marker.x + marker.width / 2, cy: marker.y + marker.height / 2, boxes: [] }); continue; }
    const boxes = [{ kind: "label", box: (await p.getByTestId("map-label").boundingBox())! }];
    if (await p.getByTestId("map-flag").count()) boxes.push({ kind: "tag", box: (await p.getByTestId("map-flag").boundingBox())! });
    pts.push({ title: (await p.getAttribute("data-title"))!, marker, cx: marker.x + marker.width / 2, cy: marker.y + marker.height / 2, boxes });
  }
  const all = pts.flatMap((p) => p.boxes.map((b) => ({ ...b, title: p.title })));
  const problems: string[] = [];
  const leaders = await page.locator('[data-testid="map-point"] line').count();
  if (leaders) problems.push(`${leaders} leader line(s)`); // labels must sit by their own point, no leader lines
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].title !== all[j].title && overlap(all[i].box, all[j].box)) problems.push(`${all[i].title} ${all[i].kind} overlaps ${all[j].title} ${all[j].kind}`);
  for (const p of pts) {
    // The label is the name with its flag word stacked under it; the nearer of the two lines sits within 6 px of the marker.
    const near = Math.min(...p.boxes.map((b) => gap(b.box, p.marker)));
    if (p.boxes.length && near > 6) problems.push(`${p.title} label is ${near.toFixed(1)}px from its marker`);
  }
  for (const p of pts) for (const b of p.boxes) {
    const own = toCenter(b.box, p.cx, p.cy);
    if (b.box.x < plot.x - 1 || b.box.y < plot.y - 1 || b.box.x + b.box.width > plot.x + plot.width + 1 || b.box.y + b.box.height > plot.y + plot.height + 1) problems.push(`${p.title} ${b.kind} leaves the plot`);
    for (const o of pts) if (o !== p) {
      const other = toCenter(b.box, o.cx, o.cy);
      if (!(own + 3 < other)) problems.push(`${p.title} ${b.kind} is nearer ${o.title} (${other.toFixed(1)}px) than its own point (${own.toFixed(1)}px)`);
    }
    for (const o of pts) if (o !== p && overlap(b.box, o.marker)) problems.push(`${p.title} ${b.kind} covers ${o.title}'s marker`);
  }
  log?.push(`map labels: ${problems.length ? problems.join("; ") : "ok"}`);
  expect(problems).toEqual([]);
}

/** WP-G: the step log is folded behind "Show steps"; open it (no-op when already open). */
export async function openSteps(page: Page, timeout?: number) {
  const t = page.getByTestId("steps-toggle");
  await t.waitFor({ timeout });
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
}
