import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Unit tests must never write the private Qloo cache: if .cache/ did not exist when the run started, it must not
 * exist when it ends (a stray write makes the cached-only suites stop skipping on the next run). Fails the run.
 */
export default function setup() {
  const dir = path.resolve(__dirname, "../.cache");
  const before = existsSync(dir);
  return () => {
    if (!before && existsSync(dir)) throw new Error(`npm test created ${dir}: a test wrote to the real Qloo cache. Point it at a temp COMP_CACHE_DIR.`);
  };
}
