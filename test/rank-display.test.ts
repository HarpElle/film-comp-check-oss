import { describe, expect, it } from "vitest";
import { shownGap } from "../lib/rank-display";

// Invented fit scores (no recorded Qloo value): the gap is the difference of the two scores as shown at 3 decimals.
describe("shownGap (display only)", () => {
  it("uses the rounded scores, not the rounded exact gap", () => {
    const a = 0.4113, b = 0.4836; // exact gap 0.0723 -> "0.072"; shown 0.411 and 0.484 -> "0.073"
    expect((b - a).toFixed(3)).toBe("0.072");
    expect(shownGap(a, b)).toBe("0.073");
  });
  it("equals the rounded exact gap when the rounding agrees", () => {
    const a = 0.3112, b = 0.3271;
    expect(shownGap(a, b)).toBe((b - a).toFixed(3));
  });
  it("is 0.000 for scores equal at 3 decimals", () => {
    expect(shownGap(0.7001, 0.7004)).toBe("0.000");
  });
});

import { withShownGaps } from "../lib/rank-display";
import { toCsv, toMarkdown } from "../lib/export";
import { CONSIDER_CUTTING } from "../lib/flag";
import type { CheckResult } from "../lib/types";
import { FAKE_SCORES } from "./fixtures/fake-gaps";

// A made-up 6-comp result shaped like a recorded run: the stored strings quote the exact gap (as lib/reasons.ts and
// lib/agent.ts write them); the display must quote the gap of the shown scores on every surface.
function fake(): CheckResult {
  const n = FAKE_SCORES.length, f3 = (x: number) => x.toFixed(3);
  const comps = FAKE_SCORES.map((a, i) => {
    const gap = i ? FAKE_SCORES[i - 1] - a : undefined, cut = i === n - 1, title = `Fake ${String.fromCharCode(65 + i)}`;
    const why = gap === undefined ? "Top fit." : `Rank ${i + 1} of ${n}, ${f3(gap)} below the next comp.${cut ? ` Gap ${f3(gap)} vs spread of the rest {spread}.` : ""}`;
    return {
      key: `fake-${i}`, match: { input: { title }, badge: "Matched", matchedTitle: title }, fit: { status: "Scored", affinity: a },
      rank: { rank: i + 1, of: n, gapToNext: gap }, considerCutting: cut, cutLabel: cut ? CONSIDER_CUTTING : undefined,
      reasons: [why], reasonsExport: [why],
    };
  });
  const low = comps[n - 1], exact = f3(low.rank.gapToNext!);
  const stored = `${CONSIDER_CUTTING}: ${low.match.matchedTitle} (${f3(FAKE_SCORES[n - 1])}, ${exact} below the next comp).`;
  return {
    comps, cutGap: low.rank.gapToNext, ranAt: "2026-01-01T00:00:00.000Z", verdictLines: ["6 of 6 comps matched.", stored], verdict: `6 of 6 comps matched. ${stored}`,
    steps: [{ n: 1, action: "rank_deck", reason: "Rank by fit.", outcome: `Lowest: ${low.match.matchedTitle}. Gap ${exact}, spread {spread}.`, choice: { label: "x", basis: { sourceId: "rank_deck", field: "gap", phrase: "gap to next", value: exact } } }],
  } as unknown as CheckResult;
}

describe("withShownGaps: one gap on every surface", () => {
  const r = fake(), low = r.comps[r.comps.length - 1];
  const exact = low.rank!.gapToNext!.toFixed(3), shown = shownGap(low.fit!.affinity!, r.comps[r.comps.length - 2].fit!.affinity!);
  it("the fixture exercises a disagreement", () => expect(shown).not.toBe(exact));
  it("rebuilds the verdict fit line from the computed gap, not the stored string", () => {
    const tampered = { ...r, verdictLines: [r.verdictLines![0], r.verdictLines![1].replace(exact, "9.999")] };
    const out = withShownGaps(tampered);
    expect(out.verdictLines![1]).toBe(`${CONSIDER_CUTTING}: ${low.match.matchedTitle} (${low.fit!.affinity!.toFixed(3)}, ${shown} below the next comp).`);
    expect(withShownGaps(r).verdict).toContain(`${shown} below the next comp`);
  });
  it("Why lines, export Why lines and the step log quote the shown gap; numbers and the cut stay exact", () => {
    const out = withShownGaps(r), c = out.comps[out.comps.length - 1];
    for (const l of [...c.reasons, ...c.reasonsExport!]) { expect(l).toContain(`${shown} below the next comp`); expect(l).toContain(`Gap ${shown} vs spread`); expect(l).not.toContain(exact); }
    expect(out.steps![0].outcome).toContain(`Gap ${shown},`);
    expect(out.steps![0].choice!.basis!.value).toBe(shown);
    expect(c.rank!.gapToNext).toBe(low.rank!.gapToNext);
    expect(out.cutGap).toBe(r.cutGap);
    expect(withShownGaps(out)).toEqual(out); // idempotent
  });
  it("Markdown and CSV carry the same gap as the row", () => {
    const md = toMarkdown(r), csv = toCsv(r);
    expect(md).not.toContain(`${exact} below the next comp`);
    expect(md).toContain(`| ${low.rank!.rank} of ${low.rank!.of} | ${shown} |`);
    expect(md).toContain(`- ${CONSIDER_CUTTING}: ${low.match.matchedTitle} (${low.fit!.affinity!.toFixed(3)}, ${shown} below the next comp).`);
    expect(csv).toContain(`"${low.rank!.rank} of ${low.rank!.of}","${shown}"`);
    expect(csv).not.toContain(`${exact} below the next comp`);
  });
});
