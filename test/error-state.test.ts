import { describe, expect, it } from "vitest";
import { agentDown, CHECK_FAILED, deckError, MAX_COMPS, MIN_COMPS, runError } from "@/lib/error-state";
import { SAMPLE_VISITOR_LIMIT, VISITOR_LIMIT } from "@/lib/messages";
import { CANT_REACH, QUOTA_USED_UP } from "@/lib/tools";
import { AGENT_UNAVAILABLE } from "@/lib/providers";
import type { CheckResult } from "@/lib/types";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `Invented Film ${i + 1} (2001)`).join("\n");

describe("error states (copy picked from what failed)", () => {
  it("bad decks: unreadable, too few (min 3), too many (max 10)", () => {
    expect(deckError("  \n ")!.kind).toBe("unreadable");
    expect(deckError(lines(MIN_COMPS - 1))!.headline).toBe("Add at least 3 comps");
    const many = deckError(lines(MAX_COMPS + 2))!;
    expect(many.headline).toBe("Up to 10 comps per check");
    expect(many.body).toBe("You entered 12. Remove 2 and run it again. Five to eight comps usually gives the clearest read.");
    expect(deckError(lines(MIN_COMPS))).toBeNull();
    expect(deckError(lines(MAX_COMPS))).toBeNull();
  });
  it("a comma list that reads as fewer than 3 comps gets the comma hint (UX audit WP-12)", () => {
    expect(deckError("A, B, C")!.body).toBe("Put each comp on its own line. Titles can contain commas, so commas don't split them.");
    expect(deckError("A\nB")!.body).toBe("The check compares each comp against the rest, so it needs a few to compare.");
  });
  it("run errors map to Qloo down, the daily limit (midnight Central time), Remove failed, or something else", () => {
    expect(runError(CANT_REACH).kind).toBe("qloo");
    expect(runError("Qloo did not answer in time.").kind).toBe("qloo");
    expect(runError(VISITOR_LIMIT).body).toBe("The sample decks still work and make no new Qloo calls. Live checks reset at midnight Central time.");
    expect(runError(SAMPLE_VISITOR_LIMIT).kind).toBe("limit");
    expect(runError(QUOTA_USED_UP).body).not.toMatch(/reset/); // a monthly quota has no midnight reset
    expect(runError(CANT_REACH, "Some Title")).toMatchObject({ kind: "remove", headline: "Couldn't re-score without Some Title", body: "Your previous results are unchanged." });
    expect(runError(AGENT_UNAVAILABLE).kind).toBe("other");
    expect(runError(CHECK_FAILED).kind).toBe("other");
  });
  it("no error view names an email address", () => {
    for (const v of [runError("x"), runError(CANT_REACH), runError(VISITOR_LIMIT), deckError("")!]) expect(`${v.headline} ${v.body}`).not.toMatch(/@/);
  });
  it("Claude down: a live Claude run whose every choice fell back to the template", () => {
    const base = { provider: "claude", comps: [], qlooCalls: 1, cacheHits: 0, ranAt: "", notes: [] } as unknown as CheckResult;
    const stats = (apiErrors: number) => ({ apiErrors }) as CheckResult["agentStats"];
    expect(agentDown({ ...base, agentStats: stats(2), steps: [{ n: 1, action: "skew", reason: "", origin: "template" }] })).toBe(true);
    expect(agentDown({ ...base, agentStats: stats(1), steps: [{ n: 1, action: "skew", reason: "", origin: "model" }] })).toBe(false);
    expect(agentDown({ ...base, agentStats: stats(0) })).toBe(false);
    expect(agentDown({ ...base, provider: "template", agentStats: stats(2) })).toBe(false); // judge-mode Remove is not an outage
  });
});
