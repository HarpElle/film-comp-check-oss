/**
 * Share links (deck in the URL, never expire) and the share head tags, on a no-key server (0 Qloo calls).
 * The sample deck is read from /api/status, not written here.
 */
import { PROVENANCE, SHARE } from "../lib/copy";
import { BROKEN_LINK } from "../lib/error-state";
import { expect, test } from "@playwright/test";
import { shareSearch } from "../lib/share";
import { waitIdle } from "./helpers";

const URL = process.env.QA_HANDOFF_URL;
test.skip(!URL, "run through e2e/run-handoff.sh");

test("head tags: title, description, canonical, Open Graph 1200x630, Twitter card, icons", async ({ page, request }) => {
  await page.goto(URL! + "/");
  const meta = (sel: string) => page.locator(sel).getAttribute("content");
  await expect(page).toHaveTitle("Film Comp Check");
  expect(await meta('meta[name="description"]')).toBeTruthy();
  expect(await meta('meta[property="og:type"]')).toBe("website");
  expect(await meta('meta[property="og:url"]')).toMatch(/^https:\/\/filmcompcheck\.com\/?$/); // Next drops the root slash; same URL
  expect(await meta('meta[property="og:image"]')).toBe("https://filmcompcheck.com/og.png");
  expect(await meta('meta[property="og:image:width"]')).toBe("1200");
  expect(await meta('meta[property="og:image:height"]')).toBe("630");
  expect(await meta('meta[property="og:image:alt"]')).toBe(SHARE.ogAlt);
  expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  expect(await meta('meta[name="theme-color"]')).toBe("#FFFFFF");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://filmcompcheck.com");
  expect(await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href")).toBe("/favicon.svg");
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")).toBe("/apple-touch-icon.png");
  for (const [path, w, h] of [["/og.png", 1200, 630], ["/apple-touch-icon.png", 180, 180]] as const) {
    const png = Buffer.from(await (await request.get(URL! + path)).body());
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h]);
  }
  expect((await request.get(URL! + "/favicon.svg")).status()).toBe(200);
});

test("a sample's share link replays it by itself; the URL carries the deck after any run", async ({ page, request }) => {
  const st = await (await request.get(URL! + "/api/status")).json();
  const sample = st.samples.find((s: { id: string }) => s.id === "pennywell");
  await page.goto(URL! + "/" + shareSearch(sample.comps));
  await waitIdle(page);
  await expect(page.getByTestId("comp-row")).toHaveCount(sample.comps.length);
  await expect(page.getByTestId("calls")).toHaveText("No new Qloo calls.");
  expect(new globalThis.URL(page.url()).search).toBe(shareSearch(sample.comps));
  // Copy share link copies that same URL.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("export-menu").locator("summary").click();
  await page.getByTestId("copy-link").click();
  await expect(page.getByTestId("copied")).toHaveText(PROVENANCE.copied);
  await expect(page.getByTestId("copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url().split("#")[0]);
});

test("any other deck is only filled in, never run on open (no live check spent)", async ({ page }) => {
  const deck = [{ title: "Alpha Film", year: 2001 }, { title: "Beta Film", year: 2002 }, { title: "Gamma Film", year: 2003 }];
  let posts = 0;
  page.on("request", (r) => { if (r.url().includes("/api/check") && r.method() === "POST") posts++; });
  await page.goto(URL! + "/" + shareSearch(deck));
  await expect(page.locator("#comps")).toHaveValue("Alpha Film | 2001\nBeta Film | 2002\nGamma Film | 2003");
  await expect(page.locator("#comps")).toBeFocused();
  await page.waitForTimeout(500);
  expect(posts).toBe(0);
});

for (const [name, search] of [["one blank comp", "?c="], ["only blank comps", "?c=&c=+"]] as const) {
  test(`a broken share link (${name}) says so, and Edit comps clears the link and focuses the box`, async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/check")) calls.push(r.url()); });
    await page.goto(URL! + "/" + search);
    const err = page.getByTestId("field-error");
    await expect(err).toHaveAttribute("data-kind", "broken-link");
    await expect(page.getByTestId("field-error-headline")).toHaveText(BROKEN_LINK.headline);
    await expect(err).toContainText(BROKEN_LINK.body);
    await page.getByTestId("field-edit").click();
    await expect(err).toHaveCount(0);
    expect(new globalThis.URL(page.url()).search).toBe("");
    await expect(page.locator("#comps")).toBeFocused();
    expect(calls).toEqual([]); // nothing ran
  });
}

// UX audit WP-16: per-URL titles from the URL alone; robots and sitemap.
test("share previews: sample and custom deck titles in the first HTML; robots.txt and sitemap.xml", async ({ request }) => {
  const head = async (path: string) => (await (await request.get(URL! + path)).text());
  expect(await head("/?sample=pennywell")).toContain("<title>Pennywell sample: comp check · Film Comp Check</title>");
  expect(await head("/?c=A&c=B&c=C")).toContain("<title>3 comps to check · Film Comp Check</title>");
  expect(await head("/")).toContain("<title>Film Comp Check</title>");
  expect(await head("/")).toContain('"@type":"WebApplication"');
  for (const p of ["/robots.txt", "/sitemap.xml"]) expect((await request.get(URL! + p)).status()).toBe(200);
});
