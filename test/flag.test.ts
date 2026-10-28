import { describe, expect, it } from "vitest";
import { labelLowest, CLOSE_CALL, CONSIDER_CUTTING } from "@/lib/flag";

describe("labelLowest (locked rule)", () => {
  it("labels Consider cutting when the gap is bigger than the spread of the rest", () => {
    const r = labelLowest([{ key: "a", affinity: 0.90 }, { key: "b", affinity: 0.91 }, { key: "c", affinity: 0.70 }, { key: "d", affinity: 0.92 }]);
    expect(r.lowest).toBe("c");
    expect(r.gap).toBeCloseTo(0.2);
    expect(r.spread).toBeCloseTo(0.02);
    expect(r.label).toBe(CONSIDER_CUTTING);
    expect(r.ranks.c).toEqual({ rank: 4, of: 4, gapToNext: expect.closeTo(0.2, 9) });
    expect(r.ranks.d.rank).toBe(1);
    expect(r.ranks.d.gapToNext).toBeUndefined();
  });
  it("labels a close call when the gap is not bigger than the spread (invented numbers shaped like a real deck)", () => {
    const r = labelLowest([{ key: "a", affinity: 0.90 }, { key: "b", affinity: 0.88 }, { key: "c", affinity: 0.86 }, { key: "d", affinity: 0.93 }]);
    expect(r.lowest).toBe("c");
    expect(r.gap).toBeCloseTo(0.02);
    expect(r.spread).toBeCloseTo(0.05);
    expect(r.label).toBe(CLOSE_CALL);
  });
  it("gap equal to spread is a close call", () => {
    expect(labelLowest([{ key: "a", affinity: 0.5 }, { key: "b", affinity: 0.6 }, { key: "c", affinity: 0.7 }]).label).toBe(CLOSE_CALL);
  });
  it("gives no label with fewer than 3 scored comps, but still ranks", () => {
    const r = labelLowest([{ key: "a", affinity: 0.5 }, { key: "b", affinity: 0.9 }]);
    expect(r.label).toBeUndefined();
    expect(r.lowest).toBeUndefined();
    expect(r.ranks.a).toEqual({ rank: 2, of: 2, gapToNext: expect.closeTo(0.4, 9) });
    expect(labelLowest([]).label).toBeUndefined();
  });
  it("breaks a tie for lowest by input order and calls it close", () => {
    const r = labelLowest([{ key: "a", affinity: 0.9 }, { key: "b", affinity: 0.5 }, { key: "c", affinity: 0.5 }]);
    expect(r.lowest).toBe("b");
    expect(r.tiedLowest).toEqual(["b", "c"]);
    expect(r.label).toBe(CLOSE_CALL);
  });
});
