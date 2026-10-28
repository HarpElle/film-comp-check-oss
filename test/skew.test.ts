import { describe, expect, it } from "vitest";
import { skewFlag, skewScores } from "@/lib/skew";

describe("skewScores", () => {
  it("uses the female value and old-minus-young age mean", () => {
    const s = skewScores({ gender: { female: 0.2, male: -0.2 }, age: { "24_and_younger": 0.1, "25_to_29": 0.3, "30_to_34": 9, "35_to_44": 9, "45_to_54": -0.2, "55_and_older": -0.4 } });
    expect(s.female).toBeCloseTo(0.2);
    expect(s.age).toBeCloseTo(-0.3 - 0.2);
  });
  it("returns undefined age when a band is missing", () => {
    expect(skewScores({ gender: { female: 0.1 }, age: { "24_and_younger": 0.1 } }).age).toBeUndefined();
    expect(skewScores(undefined)).toEqual({});
  });
});

describe("skewFlag", () => {
  it("flags only the single furthest comp, and only beyond 0.3", () => {
    const r = skewFlag([
      { key: "a", female: 0, age: 0 },
      { key: "b", female: 0.05, age: 0 },
      { key: "c", female: 0.9, age: 0 },
      { key: "d", female: 0.7, age: 0 },
    ]);
    expect(r.flagged?.key).toBe("c");
    expect(r.flagged!.dFemale).toBeCloseTo(0.9 - 0.4125);
  });
  it("flags nothing when every comp is within 0.3 of the mean", () => {
    expect(skewFlag([{ key: "a", female: 0.1, age: 0.2 }, { key: "b", female: -0.1, age: -0.2 }, { key: "c", female: 0, age: 0.1 }]).flagged).toBeUndefined();
  });
  it("counts the age score too", () => {
    const r = skewFlag([{ key: "a", female: 0, age: -0.6 }, { key: "b", female: 0, age: 0.1 }, { key: "c", female: 0, age: 0.1 }, { key: "d", female: 0, age: 0.2 }]);
    expect(r.flagged?.key).toBe("a");
  });
});

import { skewDirection, skewLabel } from "@/lib/skew";

describe("skewLabel (locked rule)", () => {
  it("k=0: no outlier", () => {
    const r = skewLabel([{ key: "a", female: 0.1, age: 0.1 }, { key: "b", female: 0, age: 0 }, { key: "c", female: -0.1, age: -0.1 }]);
    expect(r.k).toBe(0); expect(r.kind).toBe("none"); expect(r.outlier).toBeUndefined(); expect(r.split).toEqual([]);
  });
  it("k=1: one outlier with direction from the larger-distance dimension", () => {
    const r = skewLabel([{ key: "a", female: 0, age: 0 }, { key: "b", female: 0, age: 0.05 }, { key: "c", female: 0.1, age: 0.8 }, { key: "d", female: 0, age: 0 }]);
    expect(r.k).toBe(1); expect(r.kind).toBe("outlier"); expect(r.outlier!.key).toBe("c"); expect(r.outlier!.direction).toBe("an older");
  });
  it("k>=2: split, in deck order, no single outlier", () => {
    const r = skewLabel([{ key: "a", female: 0.9, age: 0 }, { key: "b", female: 0, age: 0 }, { key: "c", female: -0.6, age: 0 }, { key: "d", female: 0, age: 0 }]);
    expect(r.k).toBe(2); expect(r.kind).toBe("split"); expect(r.split).toEqual(["a", "c"]); expect(r.outlier).toBeUndefined();
  });
  it("direction wording for all four cases, age wins ties", () => {
    expect(skewDirection(0.1, 0.4)).toBe("an older");
    expect(skewDirection(0.1, -0.4)).toBe("a younger");
    expect(skewDirection(0.5, 0.2)).toBe("a more female");
    expect(skewDirection(-0.5, 0.2)).toBe("a more male");
    expect(skewDirection(0.4, -0.4)).toBe("a younger");
  });
  it("uses distance > 0.3 strictly", () => {
    const r = skewLabel([{ key: "a", female: 0.3, age: 0 }, { key: "b", female: -0.3, age: 0 }]);
    expect(r.k).toBe(0);
  });
});
