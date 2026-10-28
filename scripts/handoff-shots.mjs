// Screenshots of the handoff states at 1280x800 and 375x812 against a run-handoff.sh server (no keys, store copy).
// Usage: node scripts/handoff-shots.mjs <baseUrl> <outDir> [prefix]
import { chromium } from "@playwright/test";
const [base = "http://127.0.0.1:3095", out = "/tmp/hshots", prefix = "handoff-top"] = process.argv.slice(2);
const b = await chromium.launch();
const idle = async (p) => { await p.waitForFunction(() => !document.querySelector('[data-testid="busy"]') && !!document.querySelector('[data-testid="verdict"],[data-testid="verdict-too-few"],[data-testid="error-state"]'), null, { timeout: 120000 }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400); };
for (const w of [1280, 375]) {
  const vp = { width: w, height: w === 375 ? 812 : 800 };
  for (const state of ["landing", "pennywell", "dreamhackers"]) {
    const p = await b.newPage({ viewport: vp });
    await p.goto(base + "/");
    await p.evaluate(() => document.fonts.ready);
    if (state === "pennywell") { await p.getByRole("button", { name: "Try the Pennywell sample" }).click(); await idle(p); }
    if (state === "dreamhackers") { await p.getByRole("button", { name: /Dream Hackers/ }).first().click(); await idle(p); }
    await p.screenshot({ path: `${out}/${prefix}-${state}-${w}.png` });
    await p.close();
  }
}
await b.close();
