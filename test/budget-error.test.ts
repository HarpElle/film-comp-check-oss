import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { anthropicSend, AgentBudgetError, AGENT_BUDGET_USED, isBudgetError } from "@/lib/providers/claude";
import { AGENT_UNAVAILABLE } from "@/lib/providers";
import { checkEventStream } from "@/lib/stream";
import { readEvents, type CheckEvent } from "@/lib/events";

// Mocked fetch only. No live Anthropic calls. The key is a dummy test value.
const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
const err400 = (message: string) => ({ type: "error", error: { type: "invalid_request_error", message } });

async function screenFor(status: number, body: unknown): Promise<string | undefined> {
  mockFetch(status, body);
  const out: CheckEvent[] = [];
  for await (const e of readEvents(checkEventStream(async () => { await anthropicSend()({}); throw new Error("unreachable"); }, 4))) out.push(e);
  const last = out.at(-1) as { type: string; error?: string };
  return last.type === "error" ? (last.error === "Check failed." ? AGENT_UNAVAILABLE : last.error) : undefined;
}

describe("Anthropic spend-limit error", () => {
  const prev = process.env.QLOO_ANTHROPIC_API_KEY;
  process.env.QLOO_ANTHROPIC_API_KEY = "test-dummy";
  afterEach(() => { vi.unstubAllGlobals(); });
  afterAll(() => { if (prev === undefined) delete process.env.QLOO_ANTHROPIC_API_KEY; else process.env.QLOO_ANTHROPIC_API_KEY = prev; });

  it.each([
    "Your credit balance is too low to access the Anthropic API.",
    "You have reached your specified workspace API usage limits.",
    "Workspace SPEND LIMIT reached",
    "Monthly spending limit exceeded",
  ])("a 400 with %j shows the budget line", async (msg) => {
    mockFetch(400, err400(msg));
    await expect(anthropicSend()({})).rejects.toBeInstanceOf(AgentBudgetError);
    expect(await screenFor(400, err400(msg))).toBe(AGENT_BUDGET_USED);
  });
  it("an unrelated 400 keeps the generic line", async () => {
    expect(await screenFor(400, err400("messages: field required"))).toBe(AGENT_UNAVAILABLE);
  });
  it("a 500 keeps the generic line, even with matching text", async () => {
    expect(await screenFor(500, { type: "error", error: { type: "api_error", message: "credit balance" } })).toBe(AGENT_UNAVAILABLE);
  });
  it("only a 400 invalid_request_error matches", () => {
    expect(isBudgetError(400, { type: "invalid_request_error", message: "usage limit" })).toBe(true);
    expect(isBudgetError(429, { type: "rate_limit_error", message: "usage limit" })).toBe(false);
    expect(isBudgetError(400, undefined)).toBe(false);
    expect(AGENT_BUDGET_USED).toBe("The agent's monthly budget for this demo is used up. Nothing was scored by a model. The recorded Pennywell sample still plays.");
  });
});
