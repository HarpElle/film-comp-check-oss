import type { AgentStep, CheckResult } from "@/lib/types";
import { Icon } from "./Icon";
import { noteId } from "./linkTarget";

export const ORIGIN_TAG: Record<string, string> = { core: "Always runs", model: "Claude chose", stub: "Rule chose", template: "Template" };
/** One name for the agent in sentences (UX audit WP-6, 4.2): the provider's family name. Tags say "Claude chose" too (Oct 30). */
export const agentName = (r: Pick<CheckResult, "provider" | "providerLabel">) => (r.provider === "claude" || /claude/i.test(r.providerLabel ?? "") ? "Claude" : "The model");
/** The marker on a Why-line note names the same origin as the step that added it. */
export const NOTE_TAG = ORIGIN_TAG;

/** A step that quotes a fit score or a fit/audience-derived label (hidden when fit never ran). */
export const FIT_WORDS = /\bfit\b|affinity|close call|least viewed|consider cutting|outlier|audience split|\b0\.\d{3}/i;
const quotesFit = (st: AgentStep) => FIT_WORDS.test([st.action, st.outcome, st.reason, st.choice?.label, st.choice?.basis?.phrase, st.choice?.basis?.value, ...(st.details ?? [])].filter(Boolean).join(" "));

function StepItem({ st, live, noteTitle, onNote }: { st: AgentStep; live?: boolean; noteTitle?: string; onNote?: (compKey: string) => void }) {
  const running = live && !st.outcome;
  const origin = st.origin ?? "core";
  const tag = <span className={`origin origin-${origin}`} data-testid="origin">{ORIGIN_TAG[origin]}</span>;
  // DS StepLog (UX audit WP-7, 5.5): number (from data-npad, CSS), tag, then the body; the result sits on its own line.
  return (
    <li value={st.n} id={live ? undefined : `step-${st.n}`} className={running ? "running" : undefined} data-action={st.action} data-origin={origin} data-n={st.n} data-npad={String(st.n).padStart(2, "0")} data-note-comp={st.note?.comp} data-state={running ? "running" : "done"}>
      {tag}
      <span className="step-body">
        {st.details ? (
          <details>
            <summary><code>{st.action}</code> {st.outcome}</summary>
            <ul className="details">{st.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </details>
        ) : st.choice ? (
          <>
            <strong data-testid="choice">{st.choice.label}{st.choice.basis && <> ({st.choice.basis.phrase} <span data-testid="basis-value">{st.choice.basis.value}</span>)</>}</strong>
            <span className="muted"> {st.reason}</span>
            {st.outcome && <span className="muted step-out"> {st.outcome}</span>}
            {st.note && <span className="note-marker" data-testid="step-note-marker"> {"\u25b8"} Added to the Why line</span>}
            {st.note && !live && noteTitle && onNote && <>{" "}<a className="link-hit" href={`#${noteId(st.note.comp)}`} data-testid="step-note-link" data-comp={st.note.comp} onClick={(e) => { e.preventDefault(); onNote(st.note!.comp); }}>{noteTitle} note {"\u2191"}</a></>}
            {running && <span className="muted"> Working...</span>}
          </>
        ) : (
          <>
            <code>{st.action}</code> {st.reason}
            {st.outcome && <span className="muted step-out"> {st.outcome}</span>}
            {running && <span className="muted"> Working...</span>}
          </>
        )}
      </span>
    </li>
  );
}

/** The steps as they stream in, while a run is going. */
export function LiveSteps({ live, choosing }: { live: AgentStep[]; choosing: boolean }) {
  return (
    <section className="steps-section" data-testid="live">
      <h2>Agent steps <span className="muted small">(running)</span></h2>
      <ol className="steps" data-testid="live-steps">{live.map((st) => <StepItem key={st.n} st={st} live />)}</ol>
      {choosing && <p className="muted loading-line" data-testid="choosing"><Icon name="loader" />Agent is choosing next steps</p>}
    </section>
  );
}

/** WP-G step log of a finished run: chosen steps first, the always-run steps folded below; step numbers unchanged. */
export function StepsLog({ result, tooFew, open, onToggle, titleOfKey, onNote }: { result: CheckResult & { steps: AgentStep[] }; tooFew: boolean; open: boolean; onToggle: () => void; titleOfKey: (key?: string) => string | undefined; onNote: (key: string) => void }) {
  // Fewer than MIN_MATCHED_FOR_FIT matched: fit never ran, so no step may quote a fit score or a fit-derived label.
  // The count line counts only the steps the list shows, so the line and the list always agree.
  const visible = tooFew ? result.steps.filter((st) => !quotesFit(st)) : result.steps;
  const chosen = visible.filter((st) => st.origin && st.origin !== "core");
  const always = visible.filter((st) => !st.origin || st.origin === "core");
  return (
    <section className="steps-section" aria-labelledby="steps-h">
      <h2 id="steps-h">Agent steps {result.recorded?.replay && <span className="origin origin-template" data-testid="replay-tag">Replay</span>} <span className="muted small" data-testid="provider">{[result.provider === "stub" || /^stub$/i.test(result.providerLabel ?? "") ? "" : result.providerLabel, result.stoppedBy !== "finish" ? `stopped by ${result.stoppedBy}` : ""].filter(Boolean).join(", ").replace(/^(.+)$/, "($1)")}</span></h2>
      {chosen.length > 0 && <p className="small muted" data-testid="chose-count">{result.recorded?.replay ? "Replay: " : ""}{chosen[0].origin === "model" ? `${agentName(result)} chose` : ORIGIN_TAG[chosen[0].origin!]} {chosen.length} of {visible.length} steps; the other {visible.length - chosen.length} always run.</p>}
      <button className="btn link link-hit no-print" aria-expanded={open} aria-controls="steps-panel" data-testid="steps-toggle" onClick={onToggle}><Icon name={open ? "chevronDown" : "chevronRight"} />{open ? "Hide steps" : "Show steps"}</button>
      <div className="steps-wrap" data-testid="steps" id="steps-panel" hidden={!open}>
        {chosen.length > 0 && <ol className="steps" data-testid="chosen-steps">{chosen.map((st) => <StepItem key={st.n} st={st} noteTitle={titleOfKey(st.note?.comp)} onNote={onNote} />)}</ol>}
        {always.length > 0 && (
          <details className="always-run" data-testid="always-run">
            <summary><Icon name="chevronRight" />Always-run steps ({always.length})</summary>
            <ol className="steps">{always.map((st) => <StepItem key={st.n} st={st} noteTitle={titleOfKey(st.note?.comp)} onNote={onNote} />)}</ol>
          </details>
        )}
      </div>
    </section>
  );
}
