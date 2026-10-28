import { AGENT_BUDGET_AFTER_CORE } from "./providers/claude";
import type { CheckProgress } from "./check";
import type { CheckEvent } from "./events";
import type { CheckResult } from "./types";

/** Every streamed run ends by this time, well under the route's maxDuration (60 s on Vercel). */
export const RUN_DEADLINE_MS = 45_000;
export const OUT_OF_TIME = "The check ran out of time before it finished. Nothing was scored, so there is no verdict. Try again in a minute.";

/**
 * Wraps a check in an NDJSON stream. The start event is written before the check begins, so the
 * client has a first line before any Qloo call. Steps follow as they land, then the final result.
 * The stream always ends with a closing event: the result, or, at the run deadline, the core result
 * already computed (verdict and table are final at that point) or an explicit error the page shows.
 */
export function checkEventStream(run: (onEvent: (e: CheckProgress) => void) => Promise<CheckResult>, comps: number, deadlineMs = RUN_DEADLINE_MS): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      let core: CheckResult | undefined;
      const send = (e: CheckEvent) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { open = false; }
      };
      send({ type: "start", at: new Date().toISOString(), comps });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((res) => { timer = setTimeout(() => res("late"), deadlineMs); });
      try {
        const r = await Promise.race([run((e) => { if (e.type === "core_result") core = e.result; send(e); }), late]);
        if (r === "late") {
          if (core) send({ type: "result", result: { ...core, notes: [...core.notes, "The chosen steps ran out of time; this is the core result (verdict and table are final)."] } });
          else send({ type: "error", error: OUT_OF_TIME });
        } else send({ type: "result", result: r });
      } catch (e) {
        // Spend cap after the Qloo results streamed: keep them on screen, with the budget line under them.
        if (e instanceof Error && e.name === "AgentBudgetError" && core) send({ type: "result", result: { ...core, notes: [...core.notes, AGENT_BUDGET_AFTER_CORE] } });
        else send({ type: "error", error: e instanceof Error && (e.name === "QlooError" || e.name === "AgentUnavailableError" || e.name === "AgentBudgetError") ? e.message : "Check failed." });
      } finally { clearTimeout(timer); }
      if (open) { open = false; controller.close(); }
    },
  });
}
