import type { CheckResult } from "./types";

/** "<Mon D, YYYY>" in the user's zone (America/Chicago), from an ISO time. */
export const stampDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

/**
 * The honesty stamp for a run served from recorded Qloo results; undefined for live runs.
 * Recorded:  "Qloo results recorded <date> · <model from API> chose N of M steps live"
 * Replay:    "Replay of a recorded run · Claude chose N of M steps" (no date: the sample label above the verdict carries both dates)
 * Before the run finishes, only the first half (the step count isn't known yet).
 * `date: false` (the removed state, where the sample label above the verdict already carries the date) drops the
 * date: "Qloo results recorded · ...".
 */
export function recordedStamp(r: Pick<CheckResult, "recorded" | "steps" | "provider" | "providerLabel">, opts: { steps?: boolean; date?: boolean } = {}): string | undefined {
  if (!r.recorded) return undefined;
  const at = opts.date === false ? "" : ` ${stampDate(r.recorded.at)}`;
  if (opts.steps === false) return r.recorded.replay ? "Replay of a recorded run" : `Qloo results recorded${at}`;
  const steps = r.steps ?? [];
  const done = steps.some((s) => s.action === "finish");
  const n = steps.filter((s) => s.origin === "model" || s.origin === "stub").length;
  const rp = r.recorded.replay;
  if (rp) return `Replay of a recorded run${done ? ` · Claude chose ${n} of ${steps.length} steps` : ""}`;
  if (r.provider === "template") {
    const t = steps.filter((s) => s.origin === "template").length;
    return `Qloo results recorded${at}${done ? ` · Claude didn't run; Template steps ${t} of ${steps.length}` : ""}`;
  }
  const who = r.provider === "stub" ? "Fixed rules" : r.providerLabel && !/no model response/.test(r.providerLabel) ? r.providerLabel : "Template";
  return `Qloo results recorded${at}${done ? ` · ${who} chose ${n} of ${steps.length} steps live` : ""}`;
}

/**
 * The sample label above the verdict, from the recording's own dates; no final period
 * (the page and exports add it). Two dates when the agent steps were replayed on a later day than the Qloo record:
 *   "Sample run. Qloo data recorded <qlooDate>, agent steps replayed <agentDate>"
 * otherwise one: "Sample run, recorded <qlooDate>". Undefined for live runs.
 */
export function sampleLabel(r: Pick<CheckResult, "recorded">): string | undefined {
  if (!r.recorded) return undefined;
  const q = stampDate(r.recorded.at), rp = r.recorded.replay;
  return rp && stampDate(rp.at) !== q ? `Sample run. Qloo data recorded ${q}, agent steps replayed ${stampDate(rp.at)}` : `Sample run, recorded ${q}`;
}
