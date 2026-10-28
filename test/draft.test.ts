import { describe, expect, it } from "vitest";
import { DRAFT_KEY, loadDraft, saveDraft } from "@/lib/draft";

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const notSample = () => false;

describe("draft saving (this browser only)", () => {
  it("saves, loads and clears a typed draft", () => {
    const s = mem();
    expect(saveDraft("Alpha Film (2001)\nBeta Film (2002)", notSample, s)).toBe(true);
    expect(loadDraft(s)).toBe("Alpha Film (2001)\nBeta Film (2002)");
    expect(saveDraft("  ", notSample, s)).toBe(false);
    expect(s.m.has(DRAFT_KEY)).toBe(false);
    expect(loadDraft(s)).toBeNull();
  });
  it("a sample deck never replaces the draft", () => {
    const s = mem();
    saveDraft("Mine (2001)", notSample, s);
    expect(saveDraft("Sample (2002)", () => true, s)).toBe(false);
    expect(loadDraft(s)).toBe("Mine (2001)");
  });
  it("storage that throws (private mode, quota) is not an error", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(saveDraft("Mine", notSample, bad)).toBe(false);
    expect(loadDraft(bad)).toBeNull();
    expect(saveDraft("Mine", notSample, null)).toBe(false);
  });
});
