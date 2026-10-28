import { StubProvider, type ModelProvider } from "../agent";
import { ClaudeProvider } from "./claude";

export const AGENT_UNAVAILABLE = "The agent couldn't start. Nothing was scored by a model. Try again in a minute.";

/** Thrown when the hosted app can't build its model provider. The stream shows the message as-is. */
export class AgentUnavailableError extends Error {
  constructor() { super(AGENT_UNAVAILABLE); this.name = "AgentUnavailableError"; }
}

/**
 * On Vercel (process.env.VERCEL set) it is always Claude, never the stub: if the key is missing the run
 * ends with AgentUnavailableError instead of a run labeled "Stub". (If Claude's calls fail mid-run, the
 * existing per-item Template fallback applies, unchanged.)
 * Off Vercel, AGENT_PROVIDER=claude uses Claude (a new instance, and conversation, per run). Default is the stub.
 */
export function getProvider(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  if (env.VERCEL) {
    try { return new ClaudeProvider({ env }); } catch { throw new AgentUnavailableError(); }
  }
  return env.AGENT_PROVIDER === "claude" ? new ClaudeProvider() : new StubProvider();
}
