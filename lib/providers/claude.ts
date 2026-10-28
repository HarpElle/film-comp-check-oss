import "server-only";
import type { Choice, ChoiceFeedback, ChoiceTool, ChoiceUsage, ChoiceView, ModelProvider } from "../agent";

/**
 * Claude picks the optional steps after the fixed core, via real tool use.
 * It never sees or edits a score it could change: it gets the Qloo-based results by source ID and
 * returns one tool call. The loop checks the call (rules + source-tagged guard) before running it.
 *
 * The key is read at call time from QLOO_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) and is never
 * logged, stored or returned.
 */
export const DEFAULT_MODEL = "claude-sonnet-5-5";
/**
 * Friendly name from the response's model id, derived not hardcoded: "claude-sonnet-5-5" -> "Claude Sonnet 5.5",
 * "claude-x-4-20250514" -> "Claude X 4". Unknown shapes are shown as the raw id.
 */
export function friendlyModel(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const m = /^claude-([a-z]+(?:-[a-z]+)*)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return id;
  const family = m[1].split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return `Claude ${family} ${m[2]}${m[3] ? "." + m[3] : ""}`;
}

/** USD per million tokens, https://docs.claude.com/en/docs/about-claude/pricing (fetched 2026-10-09). */
export const PRICES: Record<string, { input: number; output: number; cacheWrite5m: number; cacheRead: number; minCacheable: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.1, minCacheable: 512 },
};

export function runCost(model: string, u: { tokensIn: number; tokensOut: number; cacheCreationTokens: number; cacheReadTokens: number }) {
  const p = PRICES[model];
  if (!p) return undefined;
  const parts = {
    input: (u.tokensIn * p.input) / 1e6,
    output: (u.tokensOut * p.output) / 1e6,
    cacheWrite: (u.cacheCreationTokens * p.cacheWrite5m) / 1e6,
    cacheRead: (u.cacheReadTokens * p.cacheRead) / 1e6,
  };
  return { ...parts, total: parts.input + parts.output + parts.cacheWrite + parts.cacheRead };
}

const claimsSchema = {
  type: "array",
  description: "One entry per placeholder {0}, {1}, ... in template, in order. Code fills the value from that result.",
  items: { type: "object", properties: { sourceId: { type: "string" }, field: { type: "string" }, kind: { type: "string", enum: ["name", "number"], description: "name if the slot holds a comp name, number if it holds a value" } }, required: ["sourceId", "field", "kind"] },
};
const common = {
  basis: {
    type: "object",
    description: "The single Qloo result value this choice is based on: a source ID from the results and one of its fields.",
    properties: { sourceId: { type: "string" }, field: { type: "string" } },
    required: ["sourceId", "field"],
  },
  reason: {
    type: "object",
    description: "One plain-English line for a film producer. Put every number and every comp name in a placeholder; free text must have no digits and no comp names.",
    properties: { template: { type: "string" }, claims: claimsSchema },
    required: ["template", "claims"],
  },
};

export const TOOLS = [
  {
    name: "check_pageviews",
    description: "Look up Wikipedia pageviews (popularity context, not a Qloo score) for the chosen scored comps. Use labels from the comps list.",
    input_schema: { type: "object", properties: { comps: { type: "array", items: { type: "string" }, minItems: 1 }, ...common }, required: ["comps", "basis", "reason"] },
  },
  {
    name: "look_at_tags",
    description: "Closer look at one scored comp's Qloo tags against the rest of the deck: how many it shares and a tag only it has. The result can add a Qloo tag note to that comp's Why line.",
    input_schema: { type: "object", properties: { comp: { type: "string" }, ...common }, required: ["comp", "basis", "reason"] },
  },
  {
    name: "rerun_after_set_aside",
    description: "Re-score the deck after a comp was set aside. Only available when a comp is set aside.",
    input_schema: { type: "object", properties: { ...common }, required: ["basis", "reason"] },
  },
  {
    name: "stop",
    description: "Stop choosing; the results are ready to show.",
    input_schema: { type: "object", properties: { ...common }, required: ["basis", "reason"] },
  },
] as const;

export const SYSTEM = `You are the optional-steps agent in a film comp checker for indie producers. Code has already run the fixed core on Qloo data: it resolved each comp, scored leave-one-out deck fit, estimated each comp's audience, and applied locked labels. You cannot change any score or label.

Your job: pick the next useful steps, or call stop. You may make several independent tool calls in one turn (for example closer looks at two comps and one pageview check); they run at the same time and each is logged on its own. A re-run must be alone in its turn. Put stop in its own turn, or last. Pick steps that help a producer understand their comp deck, for example a closer look at the tags of a comp that stands out on fit or audience, or popularity context for the comps a buyer will judge. Do not repeat a step already done. Stop when another step would add little. You have a small budget of choices.

Rules for every call:
- basis: the one numeric Qloo result value you based the choice on, given as a source ID that appears in the results (for example skew:deck, deckfit:<label>, rank_deck, tags:<label>, count:matched) and a field of it whose value is a number.
- reason.template: one short line, at most about twenty words, plain words, no jargon. Every number and every comp name must be a placeholder {0}, {1}, ... with a matching entry in reason.claims (sourceId plus field). Free text may not contain digits, comp names, other film names or quotes; mark each claim kind "name" or "number", and a name slot must hold a comp name (for example skew:deck outlier, rank_deck lowest, or a per-comp title). Code fills placeholder values from the results, so never type a value yourself. Example: template "{0} brings a different audience, gap {1}, so look at its tags." with claims [{"sourceId":"skew:deck","field":"outlier","kind":"name"},{"sourceId":"skew:deck","field":"dAge","kind":"number"}].
- Use comp labels exactly as given in the comps list.
- If a call is refused, the tool result says why; fix that and try again.

Results keys: deckfit:<label> has affinity (fit score). skew:<label> has female and age (Qloo audience estimates), distance (from the deck mean) and standout. skew:deck has meanFemale, meanAge, k (number of audience standouts), kind, and when there is one outlier: outlier, direction, dFemale and dAge (its gap from the deck mean). rank:<label> has rank, of and gapToNext. rank_deck has lowest (the lowest comp's name), lowestScore, gap, spread and label (the locked rule's label text, not a name). tags:<label> appears after a closer look and has totalTags, sharedWithDeck, uniqueCount, uniqueGenre or uniqueKeyword. Output nothing except tool calls.`;

type Block = { type: string; [k: string]: unknown };
type Msg = { role: "user" | "assistant"; content: Block[] | string };
export type SendFn = (body: Record<string, unknown>) => Promise<{ content?: Block[]; usage?: Record<string, number>; stop_reason?: string; model?: string; error?: { type?: string; message?: string } }>;

function keyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.QLOO_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || undefined;
}

export const AGENT_BUDGET_USED = "The agent's monthly budget for this demo is used up. Nothing was scored by a model. The recorded Pennywell sample still plays.";

/** Shown under the Qloo results when they already streamed and then the budget error hit. */
export const AGENT_BUDGET_AFTER_CORE = "These scores are computed from Qloo's data. The agent's monthly budget for this demo is used up, so it didn't choose any extra steps. The recorded Pennywell sample still plays.";

/** Anthropic has no separate error type for a spend cap or empty credit balance: it is a 400 invalid_request_error and only the message says so. */
const BUDGET_TEXT = /credit balance|usage limit|spend(ing)? limit/i;

/** Thrown when Anthropic says the spend cap or credits are used up. Ends the run with AGENT_BUDGET_USED. */
export class AgentBudgetError extends Error {
  constructor() { super(AGENT_BUDGET_USED); this.name = "AgentBudgetError"; }
}

export function isBudgetError(status: number, err: { type?: string; message?: string } | undefined): boolean {
  return status === 400 && err?.type === "invalid_request_error" && BUDGET_TEXT.test(err.message ?? "");
}

export function anthropicSend(): SendFn {
  return async (body) => {
    const key = keyFromEnv();
    if (!key) throw new Error("ClaudeProvider not configured");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as Awaited<ReturnType<SendFn>>;
    if (!res.ok && isBudgetError(res.status, json.error as { type?: string; message?: string })) throw new AgentBudgetError();
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${json.error?.message?.slice(0, 200) ?? "error"}`);
    return json;
  };
}

const round = (_k: string, v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(6)) : v);

/** The first turn sends every result; later turns send only results that are new or changed. */
function viewText(view: ChoiceView, seen: Map<string, string>): string {
  const results: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(view.sources)) {
    const j = JSON.stringify(v, round);
    if (seen.get(k) !== j) { results[k] = JSON.parse(j); seen.set(k, j); }
  }
  const comps = view.comps.map((c) => ({ label: c.label, scored: c.scored, pageviews: c.pageviewsChecked, tags: c.tagsChecked }));
  return JSON.stringify({ comps, toolsAvailable: view.tools, chosenSoFar: view.chosen, choicesLeft: view.choicesLeft, [seen.size && Object.keys(results).length < Object.keys(view.sources).length ? "newOrChangedResults" : "results"]: results });
}

export class ClaudeProvider implements ModelProvider {
  readonly name = "claude";
  readonly origin = "model" as const;
  readonly model: string;
  private readonly send: SendFn;
  private readonly maxOutput: number;
  private messages: Msg[] = [];
  private seen = new Map<string, string>();

  constructor(opts: { send?: SendFn; model?: string; maxOutput?: number; env?: NodeJS.ProcessEnv } = {}) {
    this.model = opts.model ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL;
    this.send = opts.send ?? anthropicSend();
    this.maxOutput = opts.maxOutput ?? (parseInt(process.env.AGENT_MAX_OUTPUT ?? "", 10) || 700);
    if (!opts.send && !keyFromEnv(opts.env)) throw new Error("ClaudeProvider not configured: QLOO_ANTHROPIC_API_KEY is not set.");
  }

  /** The request body for the current conversation. Tools and system carry cache_control (ephemeral). */
  body(): Record<string, unknown> {
    const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
    return {
      model: this.model,
      max_tokens: this.maxOutput,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools,
      tool_choice: { type: "auto" },
      thinking: { type: process.env.AGENT_THINKING || "between_tools" }, // this model's "no thinking before the reply" mode
      // Lower effort means shorter output per turn, which is most of a turn's latency. AGENT_EFFORT=default sends none.
      ...((process.env.AGENT_EFFORT ?? "low") !== "default" ? { output_config: { effort: process.env.AGENT_EFFORT ?? "low" } } : {}),
      messages: this.withHistoryBreakpoint(),
    };
  }

  /** A moving breakpoint on the newest user block, so earlier turns are read from cache on the next call. */
  private withHistoryBreakpoint(): Msg[] {
    const out = this.messages.map((m) => ({ ...m }));
    const last = out.at(-1);
    if (last && last.role === "user" && Array.isArray(last.content) && last.content.length) {
      const blocks = last.content.map((b) => ({ ...b }));
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
      last.content = blocks;
    }
    return out;
  }

  private usageOf(res: Awaited<ReturnType<SendFn>>): ChoiceUsage {
    const u = res.usage ?? {};
    return {
      model: typeof (res as { model?: unknown }).model === "string" ? (res as { model: string }).model : undefined,
      input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
      cacheCreation: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0,
    };
  }

  /**
   * Writes the tools + system prefix to the prompt cache while the core runs (max_tokens 0: no output,
   * no choice, and it never sees core results). Same tools, system and thinking setting as real calls.
   */
  async prewarm(): Promise<ChoiceUsage | undefined> {
    if (process.env.AGENT_PREWARM === "0") return undefined;
    const body = { ...this.body(), max_tokens: 0, messages: [{ role: "user", content: "warmup" }] };
    return this.usageOf(await this.send(body));
  }

  async chooseNext(view: ChoiceView, feedback: ChoiceFeedback): Promise<{ choices?: Choice[]; usage?: ChoiceUsage; error?: string }> {
    const state = { type: "text", text: viewText(view, this.seen) };
    if (!this.lastToolUseIds.length) {
      const pre = feedback.rejection ? [{ type: "text", text: `Refused: ${feedback.rejection}. Answer with tool calls only.` }] : [];
      this.messages.push({ role: "user", content: [...pre, state] });
    } else {
      const results = this.lastToolUseIds.map((id, i) => {
        const r = feedback.rejection ? `Refused: ${feedback.rejection}. Nothing ran.` : feedback.results?.[i] ?? "Not run.";
        return { type: "tool_result", tool_use_id: id, ...(r.startsWith("Refused") || r.startsWith("Not run") ? { is_error: true } : {}), content: r };
      });
      this.messages.push({ role: "user", content: [...results, state] });
    }
    this.lastToolUseIds = [];
    const res = await this.send(this.body());
    const usage = this.usageOf(res);
    if (process.env.AGENT_DEBUG === "1") console.log("[claude] blocks", JSON.stringify((res.content ?? []).map((b) => [b.type, JSON.stringify(b.input ?? b.text ?? b.thinking ?? "").length])), "usage", JSON.stringify(usage));
    const content = (res.content ?? []).filter((b) => b.type !== "thinking" || b.signature); // keep blocks the API can read back
    this.messages.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "(no reply)" }] });
    const uses = content.filter((b) => b.type === "tool_use");
    if (!uses.length) return { usage, error: "no tool call" };
    this.lastToolUseIds = uses.map((b) => String(b.id));
    const choices: Choice[] = uses.map((use) => {
      const input = (use.input ?? {}) as Record<string, unknown>;
      return {
        tool: String(use.name) as ChoiceTool,
        comps: Array.isArray(input.comps) ? input.comps.map(String) : undefined,
        comp: typeof input.comp === "string" ? input.comp : undefined,
        basis: input.basis as Choice["basis"],
        reason: (input.reason ?? { template: "", claims: [] }) as Choice["reason"],
      };
    });
    return { choices, usage };
  }
  private lastToolUseIds: string[] = [];
}
