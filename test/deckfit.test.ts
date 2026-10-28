import { describe, expect, it } from "vitest";
import { buildLeaveOneOutInputs, computeDeckFit, pickConsiderCutting, type FitScorer } from "@/lib/deckfit";

const comps = [{ key: "c0", entityId: "A" }, { key: "c1", entityId: "B" }, { key: "c2", entityId: "C" }, { key: "c3", entityId: "D" }];

describe("buildLeaveOneOutInputs", () => {
  it("scores each comp against all the others, in order", () => {
    const x = buildLeaveOneOutInputs(comps);
    expect(x.map((i) => i.target)).toEqual(["A", "B", "C", "D"]);
    expect(x[0].others).toEqual(["B", "C", "D"]);
    expect(x[2].others).toEqual(["A", "B", "D"]);
    for (const i of x) expect(i.others).not.toContain(i.target);
  });
});

describe("computeDeckFit drop-and-recompute", () => {
  it("drops an unscored comp and rescores the rest without it", async () => {
    const calls: { others: string[]; target: string }[] = [];
    const scorer: FitScorer = async (others, target) => {
      calls.push({ others, target });
      if (target === "C") return { http: 400, error: "HTTP 400" };
      return { affinity: others.includes("C") ? 0.5 : 0.9 - others.length * 0.01 - target.charCodeAt(0) / 1000, http: 200 };
    };
    const r = await computeDeckFit(comps, scorer);
    expect(r.rounds).toBe(2);
    expect(r.dropped).toEqual(["c2"]);
    expect(r.rows.get("c2")!.status).toBe("Unscored");
    // final scores for the others came from the round without C
    for (const k of ["c0", "c1", "c3"]) expect(r.rows.get(k)!.affinity).not.toBe(0.5);
    const round2 = calls.slice(4);
    expect(round2.map((c) => c.target)).toEqual(["A", "B", "D"]);
    for (const c of round2) expect(c.others).not.toContain("C");
  });
  it("treats an empty 200 as unscored", async () => {
    const r = await computeDeckFit(comps.slice(0, 3), async (_o, t) => (t === "A" ? { http: 200, error: "empty 200" } : { affinity: 0.8, http: 200 }));
    expect(r.rows.get("c0")!.status).toBe("Unscored");
    expect(r.rows.get("c1")!.status).toBe("Scored");
  });
  it("stops when fewer than 2 comps remain", async () => {
    const r = await computeDeckFit(comps.slice(0, 2), async (_o, t) => (t === "A" ? { error: "x" } : { affinity: 0.7 }));
    expect(r.rows.get("c0")!.status).toBe("Unscored");
    expect(r.rows.get("c1")!.status).toBe("Not run");
  });
  it("recomputes after the user removes a comp", async () => {
    const scorer: FitScorer = async (others, t) => ({ affinity: others.includes("D") ? 0.6 : 0.9, http: 200, ...(t ? {} : {}) });
    const before = await computeDeckFit(comps, scorer);
    const after = await computeDeckFit(comps.filter((c) => c.key !== "c3"), scorer);
    expect(before.rows.get("c0")!.affinity).toBe(0.6);
    expect(after.rows.get("c0")!.affinity).toBe(0.9);
    expect(after.rows.has("c3")).toBe(false);
  });
});

describe("pickConsiderCutting", () => {
  it("picks the lowest score and breaks ties by input order", () => {
    const rows = [
      { key: "c0", entityId: "A", status: "Scored" as const, affinity: 0.9 },
      { key: "c1", entityId: "B", status: "Scored" as const, affinity: 0.8 },
      { key: "c2", entityId: "C", status: "Unscored" as const },
      { key: "c3", entityId: "D", status: "Scored" as const, affinity: 0.8 },
    ];
    expect(pickConsiderCutting(rows)).toEqual({ pick: "c1", tied: ["c1", "c3"] });
    expect(pickConsiderCutting([rows[2]])).toEqual({});
  });
});
