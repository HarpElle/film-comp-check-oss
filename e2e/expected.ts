/**
 * Expected values for the real-deck tests, read at runtime from qa/expected.json (gitignored, generated
 * from the local Qloo cache by scripts/expected-from-cache.test.ts). The repo holds no Qloo-derived
 * literals; without the file, tests check structure and the locked rules only.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface DeckExpect {
  verdictLines: string[];
  resolveSummary: string;
  scores6: Record<string, string>;
  rows: Record<string, { score3?: string; rank?: string; director?: string; largerGap?: string }>;
  outliers: string[];
  splits: string[];
  lowest: { title: string; label: string }[];
  outlierAgeBar?: string;
  stopChoice?: { label: string; basis?: { phrase: string; value: string } };
  deckLean?: "young" | "older";
}
const f = path.join(__dirname, "..", "qa", "expected.json");
export const EXPECTED: { pennywell: DeckExpect; pennywellWithoutMidsommar: DeckExpect; dreamhackers: DeckExpect } | undefined =
  existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
