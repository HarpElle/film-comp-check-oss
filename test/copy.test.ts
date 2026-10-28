import { describe, expect, it } from "vitest";
import { COPY, FOLDED } from "@/lib/copy";

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
