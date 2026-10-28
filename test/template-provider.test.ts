import { describe, expect, it } from "vitest";
import { TemplateProvider } from "@/lib/agent";
import { recordedStamp } from "@/lib/stamp";
import type { CheckResult } from "@/lib/types";

describe("judge-mode Remove (no model key)", () => {
  it("the Template provider never makes a model choice", async () => {
    await expect(new TemplateProvider().chooseNext()).rejects.toThrow(/isn't available/);
  });
  it("the stamp says Claude didn't run and counts Template steps, never Stub or a model", () => {
    const steps = [{ n: 1, origin: "core", action: "resolve" }, { n: 2, origin: "template", action: "check_pageviews" }, { n: 3, origin: "core", action: "finish" }];
    const r = { recorded: { deck: "Invented deck", at: "2026-01-02T18:00:00Z" }, steps, provider: "template", providerLabel: "Template" } as unknown as CheckResult;
    const s = recordedStamp(r)!;
    expect(s).toBe("Qloo results recorded Jan 2, 2026 · Claude didn't run; Template steps 1 of 3");
    expect(s).not.toMatch(/Stub|chose/);
  });
});
