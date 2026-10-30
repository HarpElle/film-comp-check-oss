import { describe, expect, it } from "vitest";
import { toCsv, toMarkdown } from "@/lib/export";
import { parseCompLines } from "@/lib/parse";
import { FIXED_LINE, type CheckResult } from "@/lib/types";

const res: CheckResult = {
  comps: [{ key: "c0", match: { input: { title: "Film, One", year: 2001 }, badge: "Matched", matchedTitle: "Film, One", matchedYear: 2001, reason: "" }, fit: { key: "c0", entityId: "X", status: "Scored", affinity: 0.5 }, considerCutting: true, leastViewed: false, reasons: ["Consider cutting: lowest fit."] }],
  qlooCalls: 0, cacheHits: 0, ranAt: "t", notes: [],
};

describe("export", () => {
  it("includes the fixed line and the score", () => {
    expect(toMarkdown(res)).toContain(FIXED_LINE);
    expect(toCsv(res)).toContain(FIXED_LINE);
    expect(toCsv(res)).toContain('"0.500000"');
    expect(toCsv(res)).toContain('"Film, One (2001)"');
  });
});

describe("parseCompLines", () => {
  it("parses Title | Year | Director", () => {
    expect(parseCompLines("The Witch | 2015 | Robert Eggers\nI, Robot\n\n Ma | 2019")).toEqual([
      { title: "The Witch", year: 2015, director: "Robert Eggers" },
      { title: "I, Robot", year: undefined, director: undefined },
      { title: "Ma", year: 2019, director: undefined },
    ]);
  });
});

describe("recorded stamp in export", async () => {
  const { recordedStamp } = await import("@/lib/stamp");
  const { toCsv, toMarkdown } = await import("@/lib/export");
  const steps = [
    { n: 1, action: "resolve_comps", reason: "r", origin: "core" }, { n: 2, action: "pageviews", reason: "r", origin: "stub" }, { n: 3, action: "finish", reason: "r", origin: "core" },
  ] as unknown as import("@/lib/types").AgentStep[];
  const three = [0, 1, 2].map((i) => ({ ...res.comps[0], key: `c${i}`, match: { ...res.comps[0].match, input: { title: `Film ${i}`, year: 2001 } } }));
  const base = { ...res, comps: three, ranAt: "2026-10-09T20:00:00.000Z", steps } as unknown as import("@/lib/types").CheckResult;
  it("recorded: the recorded-run line, in Markdown and CSV", () => {
    const r = { ...base, provider: "stub", providerLabel: "stub", recorded: { deck: "Testdeck", at: "2026-10-09T17:00:00.000Z" } };
    expect(recordedStamp(r)).toBe("Qloo results recorded Oct 9, 2026 · Fixed rules chose 1 of 3 steps live");
    // Markdown has one recorded-date line (the sample label's), so its stamp drops the date (Oct 30); CSV keeps it.
    expect(toMarkdown(r)).toContain("Sample run, recorded Oct 9, 2026.");
    expect(toMarkdown(r)).toContain("Qloo results recorded · Fixed rules chose 1 of 3 steps live.");
    expect(toMarkdown(r).match(/recorded[^.\n]*Oct 9, 2026/g)).toHaveLength(1);
    expect(toCsv(r)).toContain("Qloo results recorded Oct 9, 2026 · Fixed rules chose 1 of 3 steps live.");
  });
  it("replay backup: its own line", () => {
    const st = steps.map((s) => (s.origin === "stub" ? { ...s, origin: "model" } : s)) as typeof steps;
    const r = { ...base, steps: st, provider: "claude", recorded: { deck: "Testdeck", at: "2026-10-09T17:00:00.000Z", replay: { model: "m", at: "2026-10-09T18:00:00.000Z" } } };
    expect(recordedStamp(r)).toBe("Replay of a recorded run · Claude chose 1 of 3 steps");
  });
  it("fewer than 3 matched: the stamp names no steps (screen, Markdown, CSV)", () => {
    const r = { ...base, comps: base.comps.map((c, i) => (i >= 1 ? { ...c, match: { ...c.match, badge: "Unmatched" } } : c)), provider: "stub", providerLabel: "stub", recorded: { deck: "Testdeck", at: "2026-10-09T17:00:00.000Z" } } as typeof base;
    expect(recordedStamp(r, { steps: false })).toBe("Qloo results recorded Oct 9, 2026");
    expect(toCsv(r)).toContain("Qloo results recorded Oct 9, 2026");
    expect(toMarkdown(r)).toContain("Sample run, recorded Oct 9, 2026.");
    for (const out of [toMarkdown(r), toCsv(r)]) expect(out).not.toMatch(/chose \d+ of \d+ steps/);
  });
  it("sample label: two dates when the replay is on a later day (screen line, Markdown, CSV)", async () => {
    const { sampleLabel } = await import("@/lib/stamp");
    const r = { ...base, provider: "claude", recorded: { deck: "Testdeck", at: "2026-10-19T21:12:49.012Z", replay: { model: "m", at: "2026-10-27T15:00:00.000Z" } } } as typeof base;
    const line = "Sample run. Qloo data recorded Oct 19, 2026, agent steps replayed Oct 27, 2026";
    expect(sampleLabel(r)).toBe(line);
    expect(toMarkdown(r)).toContain(line + ".");
    expect(toCsv(r)).toContain(line + ".");
  });
  it("sample label: one date when the replay is the same day, or there is no replay", async () => {
    const { sampleLabel } = await import("@/lib/stamp");
    const same = { ...base, recorded: { deck: "Testdeck", at: "2026-10-27T14:00:00.000Z", replay: { model: "m", at: "2026-10-27T15:00:00.000Z" } } } as typeof base;
    expect(sampleLabel(same)).toBe("Sample run, recorded Oct 27, 2026");
    expect(toMarkdown(same)).toContain("Sample run, recorded Oct 27, 2026.");
    expect(sampleLabel({ ...base, recorded: { deck: "Testdeck", at: "2026-10-19T21:12:49.012Z" } } as typeof base)).toBe("Sample run, recorded Oct 19, 2026");
    expect(sampleLabel(base)).toBeUndefined();
  });
  it("replay status line carries no date; the stamp above the verdict carries both (Oct 19 Qloo, Oct 27 agent)", async () => {
    const { sampleLabel } = await import("@/lib/stamp");
    const DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\b/;
    const mkSteps = (n: number, m: number) => Array.from({ length: m }, (_, i) => ({ n: i + 1, action: i === m - 1 ? "finish" : "match", reason: "r", origin: i < n ? "model" : "core" })) as unknown as typeof steps;
    const rec = { deck: "Pennywell", at: "2026-10-19T21:12:49.012Z", replay: { model: "m", at: "2026-10-27T15:00:00.000Z" } };
    const r = { ...base, steps: mkSteps(4, 11), provider: "claude", recorded: rec } as typeof base;
    const status = `No new Qloo calls. ${recordedStamp(r)}.`;
    expect(status).toBe("No new Qloo calls. Replay of a recorded run · Claude chose 4 of 11 steps.");
    expect(status).not.toMatch(DATE);
    expect(`${sampleLabel(r)}.`).toBe("Sample run. Qloo data recorded Oct 19, 2026, agent steps replayed Oct 27, 2026.");
    // N of M stays dynamic; no replay case (any day, before finish, or fewer than 3 matched) shows a date
    expect(recordedStamp({ ...r, steps: mkSteps(2, 7) })).toBe("Replay of a recorded run · Claude chose 2 of 7 steps");
    expect(recordedStamp({ ...r, steps: mkSteps(2, 7).slice(0, 3) })).toBe("Replay of a recorded run");
    expect(recordedStamp(r, { steps: false })).toBe("Replay of a recorded run");
    const sameDay = { ...r, recorded: { ...rec, replay: { model: "m", at: "2026-10-19T22:00:00.000Z" } } } as typeof base;
    expect(recordedStamp(sameDay)).not.toMatch(DATE);
    for (const out of [toMarkdown(r), toCsv(r)]) { expect(out).toContain("Replay of a recorded run · Claude chose 4 of 11 steps."); expect(out).toContain("Qloo data recorded Oct 19, 2026, agent steps replayed Oct 27, 2026."); }
  });
  it("live runs carry no stamp", () => { expect(recordedStamp(base)).toBeUndefined(); });
});
