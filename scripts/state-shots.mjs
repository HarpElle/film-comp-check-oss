// Screenshots of named UI states at 1280x800 and 375x812 against a run-handoff.sh server (no keys, store copy, 0 Qloo calls).
// Usage: node scripts/state-shots.mjs <baseUrl> <outDir> [state ...]   (default: every state below)
import { chromium } from "@playwright/test";
const [base = "http://127.0.0.1:3095", out = "/tmp/state-shots", ...pick] = process.argv.slice(2);
const idle = async (p) => { await p.waitForFunction(() => !document.querySelector('[data-testid="busy"]') && !!document.querySelector('[data-testid="verdict"],[data-testid="verdict-too-few"],[data-testid="error-state"],[data-testid="field-error"]'), null, { timeout: 120000 }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400); };
const sample = async (p, name = "Try the Pennywell sample") => { await p.goto(base + "/"); await p.evaluate(() => document.fonts.ready); await p.getByRole("button", { name }).first().click(); await idle(p); };
export const STATES = {
  landing: async (p) => { await p.goto(base + "/"); await p.evaluate(() => document.fonts.ready); },
  pennywell: (p) => sample(p),
  dreamhackers: (p) => sample(p, /Dream Hackers/),
  "remove-midsommar": async (p) => { await sample(p); await p.getByRole("button", { name: "Remove Midsommar" }).click(); await idle(p); },
  "undo-midsommar": async (p) => { await sample(p); await p.getByRole("button", { name: "Remove Midsommar" }).click(); await idle(p); await p.getByTestId("undo-remove").click(); await idle(p); },
  "step-link": async (p) => {
    await sample(p);
    const key = await p.evaluate(() => document.querySelector("[data-testid=note-marker]")?.closest("tr")?.getAttribute("data-key"));
    await p.locator(`[data-testid=comp-row][data-key="${key}"] [data-testid=comp-toggle]`).click();
    await p.locator(`[data-testid=comp-detail][data-key="${key}"] [data-testid=note-marker]`).click();
    await p.waitForTimeout(300);
  },
};
STATES["share-custom"] = async (p) => { await p.goto(base + "/?c=Alpha+Film+%7C+2001&c=Beta+Film+%7C+2002&c=Gamma+Film+%7C+2003"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500); };
STATES["share-menu"] = async (p) => { await sample(p); await p.context().grantPermissions(["clipboard-read", "clipboard-write"]); await p.getByTestId("export-menu").locator("summary").click(); await p.getByTestId("copy-link").click(); await p.waitForTimeout(200); };
const failWith = (p, error) => p.route(/\/api\/check/, (r) => r.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", error }) + "\n" }));
const msg = { cant: "This check couldn't reach Qloo. Nothing was scored. Try again in a minute.", limit: "You've used today's live checks. The sample decks still run.", other: "Check failed." };
const go = async (p, path) => { await p.goto(base + path); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500); };
const failSample = (m) => async (p) => { await p.goto(base + "/"); await failWith(p, m); await p.getByRole("button", { name: "Try the Pennywell sample" }).first().click(); await idle(p); };
Object.assign(STATES, {
  "steps-open": async (p) => { await sample(p); await p.getByTestId("steps-toggle").click(); await p.getByTestId("steps-toggle").scrollIntoViewIfNeeded(); await p.waitForTimeout(200); },
  "demo-seeded": async (p) => { await go(p, "/?sample=pennywell&without=Midsommar"); await p.getByTestId("change-summary-text").waitFor(); await idle(p); },
  running: async (p) => { await p.goto(base + "/"); await p.route(/\/api\/check/, () => new Promise(() => {})); await p.getByRole("button", { name: "Try the Pennywell sample" }).first().click(); await p.waitForTimeout(600); },
  draft: async (p) => { await p.goto(base + "/"); await p.locator("#comps").fill("Alpha Film (2001)\nBeta Film (2002)\nGamma Film (2003)"); await p.locator("#comps").scrollIntoViewIfNeeded(); await p.waitForTimeout(200); },
  "draft-back": async (p) => { await p.goto(base + "/"); await p.locator("#comps").fill("Alpha Film (2001)\nBeta Film (2002)\nGamma Film (2003)"); await p.getByRole("button", { name: "Try the Pennywell sample" }).first().click(); await idle(p); await p.getByRole("button", { name: "Edit comps" }).click(); await p.waitForTimeout(200); },
  "error-qloo": failSample(msg.cant),
  "error-limit": failSample(msg.limit),
  "error-other": failSample(msg.other),
  "error-remove": async (p) => { await sample(p); await failWith(p, msg.cant); await p.getByRole("button", { name: "Remove Midsommar" }).click(); await idle(p); },
  "error-claude": async (p) => {
    await p.route(/\/api\/check/, async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).trim().split("\n").map((l) => { const e = JSON.parse(l); if (e.type === "result") e.result = { ...e.result, provider: "claude", recorded: undefined, agentStats: { ...(e.result.agentStats ?? {}), apiErrors: 1 }, steps: (e.result.steps ?? []).map((st) => (st.origin === "model" ? { ...st, origin: "template" } : st)) }; return JSON.stringify(e); }).join("\n") + "\n";
      await route.fulfill({ response: res, body });
    });
    await sample(p);
  },
  "field-too-few": (p) => go(p, "/?c=Alpha+Film&c=Beta+Film"),
  "field-too-many": (p) => go(p, "/?" + Array.from({ length: 12 }, (_, i) => `c=Film+${i + 1}`).join("&")),
});
const keepScroll = new Set(["step-link", "share-custom", "steps-open", "draft", "draft-back", "field-too-few", "field-too-many"]);
const b = await chromium.launch();
for (const w of [1280, 375]) {
  for (const name of pick.length ? pick : Object.keys(STATES)) {
    const p = await b.newPage({ viewport: { width: w, height: w === 375 ? 812 : 800 } });
    await STATES[name](p);
    if (!keepScroll.has(name)) { await p.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, 0); }); await p.waitForTimeout(200); }
    await p.screenshot({ path: `${out}/${name}-${w}.png` });
    await p.close();
  }
}
await b.close();
