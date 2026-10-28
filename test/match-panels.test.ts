/** Error copy items 3 and 4: an unmatched comp, and a comp whose title fits records from several years. Invented titles and years. */
import { describe, expect, it } from "vitest";
import { pickMatch, MAX_OPTIONS } from "@/lib/match";
import { trimMatch } from "@/lib/trim";
import { several, unmatched } from "@/lib/error-state";
import type { QlooEntity } from "@/lib/qloo";

const rec = (name: string, year?: number): QlooEntity => ({ entity_id: `${name}-${year}`, name, properties: year ? { release_year: year } : {}, popularity: 0.5 } as QlooEntity);

describe("several matches", () => {
  it("no year and records from different years: options in returned order, the first still used", () => {
    const m = pickMatch({ title: "Lantern Field" }, [rec("Lantern Field", 1987), rec("Other Film", 2001), rec("Lantern Field", 2011), rec("Lantern Field", 1987)]);
    expect(m.badge).toBe("Matched");
    expect(m.matchedYear).toBe(1987);
    expect(m.options).toEqual([{ title: "Lantern Field", year: 1987, type: "Film" }, { title: "Lantern Field", year: 2011, type: "Film" }]);
  });
  it("a year given, or one year only: no options", () => {
    expect(pickMatch({ title: "Lantern Field", year: 2011 }, [rec("Lantern Field", 1987), rec("Lantern Field", 2011)]).options).toBeUndefined();
    expect(pickMatch({ title: "Lantern Field" }, [rec("Lantern Field", 1987), rec("Lantern Field", 1987)]).options).toBeUndefined();
  });
  it("at most MAX_OPTIONS, and the store whitelist keeps only title, year and type", () => {
    const m = pickMatch({ title: "Lantern Field" }, Array.from({ length: MAX_OPTIONS + 3 }, (_, i) => rec("Lantern Field", 1950 + i)));
    expect(m.options).toHaveLength(MAX_OPTIONS);
    const t = trimMatch({ ...m, options: [...m.options!.map((o) => ({ ...o, entity_id: "X", tags: ["y"] }))] });
    expect(t.options).toEqual(m.options);
    expect(trimMatch({ ...m, options: [{ title: "Lantern Field", year: 1950 }] }).options).toBeUndefined();
  });
});

describe("match panel copy", () => {
  it("items 3 and 4, word for word", () => {
    const u = unmatched("Lantern Field");
    expect([u.headline, u.body, u.actions]).toEqual(["We couldn't match \"Lantern Field\"", "Try the title with its year, like Ma (2019). If it's a short or a festival film, Qloo may not have it yet.", ["edit"]]);
    const s = several("Lantern Field");
    expect([s.headline, s.body]).toEqual(["\"Lantern Field\" matches more than one title", "Pick the one you meant."]);
  });
});
