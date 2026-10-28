/**
 * Production build with an empty COMP_CACHE_DIR and no Qloo key: the Pennywell sample ends in the plain
 * error state. No Qloo request can leave: with the key empty the client fails before any fetch
 * (an empty QLOO_API_KEY in the environment also keeps .env.local from supplying one).
 */
import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3076, URL = `http://127.0.0.1:${PORT}`;
const FORBIDDEN = [/of \d+ comps matched/, /No audience outlier/, /No lowest-fit label/, /No Qloo calls were needed/, /no comp clearly stands apart/];
let server: ChildProcess, cache: string;

test.beforeAll(async () => {
  cache = mkdtempSync(path.join(os.tmpdir(), "no-qloo-cache-"));
  server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: path.join(__dirname, ".."), env: { ...process.env, KV_REST_API_URL: "", KV_REST_API_TOKEN: "", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", SHARED_STORE: "", QLOO_API_KEY: "", COMP_CACHE_DIR: cache, AGENT_PROVIDER: "stub" }, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL)).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("server did not start");
});
test.afterAll(() => { try { process.kill(-server.pid!); } catch { /* gone */ } });

test("no key, empty cache: the Pennywell sample ends in the plain error state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(URL);
  await page.getByRole("button", { name: "Try the Pennywell sample" }).click();
  await expect(page.getByTestId("error-state")).toBeVisible();
  await expect(page.getByTestId("busy")).toHaveCount(0);
  await expect(page.getByTestId("error-headline")).toHaveText("Qloo isn't answering right now");
  await expect(page.getByTestId("error-detail")).toHaveCount(0);
  await expect(page.getByTestId("deck-map")).toHaveCount(0);
  await expect(page.getByTestId("map-placeholder")).toHaveCount(0);
  await expect(page.getByTestId("comp-row")).toHaveCount(0);
  await expect(page.getByTestId("skeleton-row")).toHaveCount(0);
  await expect(page.getByTestId("results")).toHaveCount(0);
  await expect(page.getByTestId("export-menu")).toHaveCount(0);
  await expect(page.getByText("Export", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("verdict")).toHaveCount(0);
  await expect(page.getByTestId("error-sample")).toBeVisible(); // the sample button stays
  const body = await page.locator("body").innerText();
  for (const f of FORBIDDEN) expect(body).not.toMatch(f);
  await page.screenshot({ path: path.join(__dirname, "..", "qa", "no-qloo-error.png") });
  // Nothing was cached, because nothing came back from Qloo.
  expect(readdirSync(cache)).toEqual([]);
});
