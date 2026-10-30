import { describe, expect, it } from "vitest";
import { COPY, FOLDED, INPUT } from "@/lib/copy";

describe("landing copy", () => {
  it("uses the locked who-pays block and the new differs line", () => {
    const all = FOLDED.join(" ");
    expect(all).toContain("$599 for 10 films from FilmProposals");
    expect(all).toContain("$299 for a FILM.FUND Comparable Film Report");
    expect(all).not.toContain("$799");
    expect(all).not.toContain("Largo");
    expect(all).toContain("How it differs: Other tools help you find or build comps. This checks the comps you already picked.");
    expect(FOLDED[0]).toBe(COPY.whoPays);
  });
});

describe("comps count (UX audit WP-12)", () => {
  it("names the limits when a deck is outside 3 to 10", () => {
    expect(INPUT.count(1)).toBe("1 comp (3 min)");
    expect(INPUT.count(2)).toBe("2 comps (3 min)");
    expect(INPUT.count(5)).toBe("5 comps");
    expect(INPUT.count(12)).toBe("12 comps (10 max)");
  });
});
