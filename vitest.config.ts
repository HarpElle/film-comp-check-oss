import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "."), "server-only": path.resolve(__dirname, "test/stubs/server-only.ts") } },
  test: { include: ["test/**/*.test.ts"], environment: "node", globalSetup: ["test/global-cache-guard.ts"] },
});
