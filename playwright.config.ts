import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.QA_PORT ?? 3088);

export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000,
  expect: { timeout: 150_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1280, height: 800 }, acceptDownloads: true },
  webServer: { command: `npx next start -p ${PORT} -H 127.0.0.1`, url: `http://127.0.0.1:${PORT}`, reuseExistingServer: false, timeout: 60_000 },
});
