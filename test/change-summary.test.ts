import { describe, expect, it } from "vitest";
import { flagChanges, removalSummary, restoreAt } from "@/lib/change-summary";
import type { CheckResult, CompResult } from "@/lib/types";

// Invented decks (no Qloo values): only labels matter here.
const comp = (title: string, extra: Partial<CompResult> = {}): CompResult => ({ key: title, match: { input: { title }, badge: "Matched" }, reasons: [], ...extra } as unknown as CompResult);
const res = (comps: CompResult[]): CheckResult => ({ comps } as unknown as CheckResult);

describe("removal change summary (WP-C)", () => {
  it("names each comp whose cut label changed, using the computed labels", () => {
    const before = res([comp("Alpha", { considerCutting: true, cutLabel: "Lowest fit, close call" }), comp("Bravo"), comp("Charlie")]);
    const after = res([comp("Alpha", { considerCutting: true, cutLabel: "Consider cutting" }), comp("Bravo")]);
    expect(removalSummary("Charlie", before, after)).toBe("Rechecked without Charlie. Alpha changed from Lowest fit, close call to Consider cutting.");
  });
  it("covers skew flags gained or lost", () => {
    const before = res([comp("Alpha", { skewFlag: { label: "Qloo's estimate" } as never }), comp("Bravo")]);
    const after = res([comp("Alpha"), comp("Bravo", { skewSplit: ["Bravo"] as never })]);
    expect(flagChanges(before, after)).toEqual(["Alpha changed from Audience outlier to no flag.", "Bravo changed from no flag to Audience split."]);
  });
  it("says No flags changed. when nothing moved", () => {
    const before = res([comp("Alpha"), comp("Bravo"), comp("Charlie")]);
    expect(removalSummary("Charlie", before, res([comp("Alpha"), comp("Bravo")]))).toBe("Rechecked without Charlie. No flags changed.");
  });
  it("Undo puts the comp back at its original index", () => {
    expect(restoreAt(["a", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(restoreAt(["a", "b"], "z", 9)).toEqual(["a", "b", "z"]);
  });
});
