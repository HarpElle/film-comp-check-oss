import { describe, expect, it } from "vitest";
import { SAMPLE_QUIET } from "@/lib/messages";

describe("sample quiet line (after the status line)", () => {
  it("reads exactly 'Run again on your own deck to compare live.' with no 'Recorded run.'", () => {
    expect(SAMPLE_QUIET).toBe("Run again on your own deck to compare live.");
    expect(SAMPLE_QUIET).not.toContain("Recorded run.");
  });
});
