import { describe, expect, it } from "vitest";
import { shareMeta } from "@/lib/share-meta";
import { shareSearch } from "@/lib/share";

// Made-up samples: the titles are invented, never recorded.
const samples = [{ id: "alpha", label: "Alpha deck", comps: [{ title: "One" }, { title: "Two" }, { title: "Three" }, { title: "Four" }] }];
const params = (search: string) => { const o: Record<string, string[]> = {}; new URLSearchParams(search).forEach((v, k) => (o[k] ??= []).push(v)); return o; };

describe("share metadata (UX audit WP-16)", () => {
  it("a sample link names the sample; with without, the comp left out", () => {
    expect(shareMeta({ sample: "alpha" }, samples)).toEqual({ title: "Alpha sample: comp check · Film Comp Check", description: "4 comps checked with Qloo taste data. Recorded sample run." });
    expect(shareMeta({ sample: "alpha", without: "Two" }, samples)).toEqual({ title: "Alpha sample without Two · Film Comp Check", description: "3 comps checked with Qloo taste data. Recorded sample run." });
    expect(shareMeta(params(shareSearch(samples[0].comps)), samples)!.title).toBe("Alpha sample: comp check · Film Comp Check");
  });
  it("a custom deck names its first three titles", () => {
    expect(shareMeta(params("?c=A&c=B&c=C"), samples)).toEqual({ title: "3 comps to check · Film Comp Check", description: "A, B, C. Open to check this comp slide." });
    expect(shareMeta(params("?c=A&c=B&c=C&c=D&c=E"), samples)!.description).toBe("A, B, C and 2 more. Open to check this comp slide.");
  });
  it("the landing and a broken link keep the defaults", () => {
    expect(shareMeta({}, samples)).toBeUndefined();
    expect(shareMeta(params("?c="), samples)).toBeUndefined();
    expect(shareMeta(params("?c=A"), samples)).toBeUndefined();
    expect(shareMeta({ sample: "nope" }, samples)).toBeUndefined();
  });
});
