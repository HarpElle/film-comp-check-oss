import { describe, expect, it } from "vitest";
import { readShare, shareSearch, shareUrl } from "@/lib/share";

// Invented titles.
const deck = [{ title: "Alpha Film", year: 2001 }, { title: "Beta & Gamma", year: 2002, director: "Some Person" }, { title: "Delta: Part 2" }];

describe("share links (deck in the URL, never expire)", () => {
  it("round-trips a deck, including punctuation and directors", () => {
    expect(readShare(shareSearch(deck))!.comps).toEqual(deck);
  });
  it("is a plain URL with no id or token to look up", () => {
    const u = shareUrl("https://example.test/", deck);
    expect(u.startsWith("https://example.test/?c=")).toBe(true);
    expect(new URL(u).searchParams.getAll("c")).toHaveLength(3);
  });
  it("no deck: null; a bad deck carries its validation message", () => {
    expect(readShare("")).toBeNull();
    expect(readShare("?x=1")).toBeNull();
    expect(readShare("?c=Only+one")!.error).toBe("Enter between 3 and 10 comps.");
    expect(readShare("?" + Array.from({ length: 11 }, (_, i) => `c=Film+${i}`).join("&"))!.error).toBe("Enter between 3 and 10 comps.");
  });
  it("a `c` parameter with nothing in it is a broken link, not 'no deck'", async () => {
    expect(readShare("?c=")).toEqual({ comps: [], error: "empty" });
    expect(readShare("?c=+&c=")!.error).toBeTruthy();
    const { BROKEN_LINK } = await import("@/lib/error-state");
    expect(`${BROKEN_LINK.headline} ${BROKEN_LINK.body}`).toBe("This link is broken or out of date. Run the check again to get a fresh one.");
    expect(BROKEN_LINK.actions).toEqual(["new-check"]);
  });
});
