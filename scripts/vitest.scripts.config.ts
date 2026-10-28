import { defineConfig } from "vitest/config";
import path from "node:path";
const root = path.resolve(__dirname, "..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root, "server-only": path.resolve(root, "test/stubs/server-only.ts") } },
  test: { include: ["scripts/*.test.ts", "scripts/build-*.ts", "scripts/seed-store.ts", "scripts/seed-synthetic.ts", "scripts/seed-memory.ts", "scripts/scan-public.ts"], environment: "node" },
});
