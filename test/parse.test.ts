import { describe, expect, it } from "vitest";
import { parseCompLines } from "@/lib/parse";
import { initialState, scoreDeck, MIN_MATCHED_FOR_FIT, type ToolDeps } from "@/lib/tools";

describe("parseCompLines", () => {
  it("reads Title (Year)", () => {
    expect(parseCompLines("Arrival (2016)")).toEqual([{ title: "Arrival", year: 2016, director: undefined }]);
    expect(parseCompLines("Amélie (2001)")).toEqual([{ title: "Amélie", year: 2001, director: undefined }]);
  });
  it("reads Title | Year | Director, accents kept", () => {
    expect(parseCompLines("Amélie | 2001")).toEqual([{ title: "Amélie", year: 2001, director: undefined }]);
    expect(parseCompLines("Arrival | 2016 | Villeneuve")).toEqual([{ title: "Arrival", year: 2016, director: "Villeneuve" }]);
  });
  it("leaves a title with no year alone", () => {
    expect(parseCompLines("Se7en")).toEqual([{ title: "Se7en", year: undefined, director: undefined }]);
  });
});

describe("fit minimum", () => {
  const deps = (calls: string[]) => ({ fit: async (_o: string[], t: string) => { calls.push(t); return { affinity: 0.5 }; } }) as unknown as ToolDeps;
  const matched = (n: number) => {
    const s = initialState(Array.from({ length: n }, (_, i) => ({ title: `Synthetic ${i}` })));
    s.comps.forEach((c, i) => { c.state = "active"; c.match = { input: c.input, badge: "Matched", entityId: `E${i}`, matchedTitle: c.input.title } as never; });
    return s;
  };
  it("needs 3 matched comps", async () => {
    expect(MIN_MATCHED_FOR_FIT).toBe(3);
    const calls: string[] = [];
    const s2 = matched(2); await scoreDeck(s2, deps(calls));
    expect(calls).toHaveLength(0);
    expect(s2.comps.every((c) => c.fit?.status === "Not run")).toBe(true);
    const s3 = matched(3); await scoreDeck(s3, deps(calls));
    expect(calls).toHaveLength(3);
    expect(s3.comps.every((c) => c.fit?.status === "Scored")).toBe(true);
  });
});

describe("WP-I line formats", () => {
  it("reads a trailing (YYYY) as the year, with or without a director", () => {
    expect(parseCompLines("Get Out (2017)")).toEqual([{ title: "Get Out", year: 2017, director: undefined }]);
    expect(parseCompLines("Synthetic Film (2001) | Some Director")).toEqual([{ title: "Synthetic Film", year: 2001, director: "Some Director" }]);
    expect(parseCompLines("Synthetic Film (2001) | 2003 | Some Director")).toEqual([{ title: "Synthetic Film", year: 2003, director: "Some Director" }]);
  });
  it("reads tab-separated lines like pipes", () => {
    expect(parseCompLines("Synthetic Film\t2001\tSome Director\nOther Film\t\tA Director")).toEqual([
      { title: "Synthetic Film", year: 2001, director: "Some Director" },
      { title: "Other Film", year: undefined, director: "A Director" },
    ]);
  });
  it("keeps pipe lines as before", () => {
    expect(parseCompLines("Synthetic Film | 2001 | Some Director\nOther Film")).toEqual([
      { title: "Synthetic Film", year: 2001, director: "Some Director" },
      { title: "Other Film", year: undefined, director: undefined },
    ]);
  });
});
