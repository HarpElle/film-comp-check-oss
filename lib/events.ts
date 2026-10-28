import type { AgentStep, CheckResult } from "./types";

/** NDJSON events sent by POST /api/check?stream=1, one JSON object per line, in this order:
 *  start, then step events (started/done per step, rejected steps only as done), then result or error. */
export type CheckEvent =
  | { type: "start"; at: string; comps: number }
  | { type: "step"; phase: "started" | "done"; step: AgentStep }
  | { type: "core_result"; result: CheckResult }
  | { type: "qloo_live" } // the run is calling Qloo live: old results are now stale // the core is done: verdict and table are final; chosen steps follow
  | { type: "result"; result: CheckResult }
  | { type: "error"; error: string };

/** Splits an NDJSON byte stream into events. Shared by the browser and the tests. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<CheckEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line) as CheckEvent;
    }
    if (done) break;
  }
  if (buf.trim()) yield JSON.parse(buf) as CheckEvent;
}
