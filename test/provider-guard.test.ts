import { describe, expect, it } from "vitest";
import { getProvider, AgentUnavailableError, AGENT_UNAVAILABLE } from "@/lib/providers";
import { checkEventStream } from "@/lib/stream";
import { readEvents, type CheckEvent } from "@/lib/events";
import { recordedStamp } from "@/lib/stamp";
import type { CheckResult } from "@/lib/types";
type StepRecord = NonNullable<CheckResult["steps"]>[number];

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("Vercel provider guard", () => {
  it("on Vercel with a key, uses Claude even without AGENT_PROVIDER", () => {
    expect(getProvider(env({ VERCEL: "1", QLOO_ANTHROPIC_API_KEY: "k" })).origin).toBe("model");
  });
  it("on Vercel, AGENT_PROVIDER=stub is ignored", () => {
    expect(getProvider(env({ VERCEL: "1", AGENT_PROVIDER: "stub", QLOO_ANTHROPIC_API_KEY: "k" })).name).not.toBe("stub");
  });
  it("on Vercel without a key, throws the plain error instead of falling back to the stub", () => {
    const prev = { a: process.env.QLOO_ANTHROPIC_API_KEY, b: process.env.ANTHROPIC_API_KEY };
    delete process.env.QLOO_ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => getProvider(env({ VERCEL: "1" }))).toThrow(AgentUnavailableError);
      expect(() => getProvider(env({ VERCEL: "1" }))).toThrow(AGENT_UNAVAILABLE);
    } finally {
      if (prev.a !== undefined) process.env.QLOO_ANTHROPIC_API_KEY = prev.a;
      if (prev.b !== undefined) process.env.ANTHROPIC_API_KEY = prev.b;
    }
  });
  it("off Vercel the stub stays the default", () => {
    expect(getProvider(env({})).origin).toBe("stub");
  });
  it("the stream shows the agent error message as-is", async () => {
    const out: CheckEvent[] = [];
    for await (const e of readEvents(checkEventStream(async () => { throw new AgentUnavailableError(); }, 4))) out.push(e);
    expect(out.at(-1)).toEqual({ type: "error", error: AGENT_UNAVAILABLE });
  });
  it("status line counts come from the run, not hardcoded", () => {
    const mk = (o: string[]) => [...o.map((origin) => ({ origin, action: "x" })), { origin: "core", action: "finish" }] as unknown as StepRecord[];
    const base = { recorded: { deck: "d", at: "2026-10-10T12:00:00Z" }, provider: "claude", providerLabel: "Claude Sonnet 5.5" };
    expect(recordedStamp({ ...base, steps: mk(["core", "model", "model"]) })).toMatch(/Claude Sonnet 5\.5 chose 2 of 4 steps live$/);
    expect(recordedStamp({ ...base, steps: mk(["core", "model", "model", "model", "model", "core"]) })).toMatch(/chose 4 of 7 steps live$/);
  });
});

describe("provider guard reads the env it is given", () => {
  it("a key only in the passed env (not process.env) still selects Claude on Vercel", () => {
    const prev = { a: process.env.QLOO_ANTHROPIC_API_KEY, b: process.env.ANTHROPIC_API_KEY };
    delete process.env.QLOO_ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try { expect(getProvider(env({ VERCEL: "1", QLOO_ANTHROPIC_API_KEY: "k" })).origin).toBe("model"); }
    finally { if (prev.a !== undefined) process.env.QLOO_ANTHROPIC_API_KEY = prev.a; if (prev.b !== undefined) process.env.ANTHROPIC_API_KEY = prev.b; }
  });
});
