import type { ReactNode } from "react";
import { CHECK_FAILED, several, unmatched, type ErrorAction, type ErrorView } from "@/lib/error-state";
import type { CompResult, MatchOption } from "@/lib/types";
import { Icon, type IconName } from "./Icon";

const LABEL: Record<ErrorAction, { text: string; icon: IconName }> = {
  retry: { text: "Try again", icon: "refresh" },
  sample: { text: "Open a sample deck", icon: "play" },
  edit: { text: "Edit list", icon: "pencil" },
  add: { text: "Add comps", icon: "pencil" },
  "agent-again": { text: "Run the agent again", icon: "refresh" },
  "new-check": { text: "Run a new check", icon: "play" },
};

/**
 * A failed run (presentational): WP-F's exact "Check failed." line, then the headline, body and buttons for
 * what failed, the server's own sentence (testid error-detail; not on the Qloo card, whose body already says it),
 * and `extra` (the other sample, if any).
 */
export function RunErrorPanel({ view, detail, on, extra }: { view: ErrorView; detail?: string; on: (a: ErrorAction) => void; extra?: ReactNode }) {
  return (
    <div className="error-state" data-testid="error-state" data-kind={view.kind} role="alert">
      <p className="check-failed" data-testid="check-failed"><Icon name="warn" />{CHECK_FAILED}</p>
      <h2 data-testid="error-headline">{view.headline}</h2>
      <p data-testid="error-body">{view.body}</p>
      {detail && detail !== CHECK_FAILED && view.kind !== "qloo" && <p className="small muted" data-testid="error-detail">{detail}</p>}
      <div className="error-actions">
        {view.actions.map((a, i) => (
          <button key={a} className={`btn${i === 0 ? " primary" : ""}${a === "sample" ? " sample" : ""}`} data-testid={a === "sample" ? "error-sample" : `error-${a}`} onClick={() => on(a)}>
            <Icon name={LABEL[a].icon} />{LABEL[a].text}
          </button>
        ))}
        {extra}
      </div>
    </div>
  );
}

/** A deck that can't be checked yet, inline under the box (WP-I validation: icon, #333 text, aria-describedby target). */
export function FieldError({ view, on }: { view: ErrorView; on: (a: ErrorAction) => void }) {
  return (
    <div className="field-error" id="field-error" role="alert" data-testid="field-error" data-kind={view.kind}>
      <Icon name="alert" />
      <div>
        <p><strong data-testid="field-error-headline">{view.headline}</strong></p>
        <p>{view.body}</p>
        <button className="btn sm" data-testid={`field-${view.actions[0]}`} onClick={() => on(view.actions[0])}>{LABEL[view.actions[0]].text}</button>
      </div>
    </div>
  );
}

/** Claude didn't answer but Qloo did: the verdict is complete; a notice, not an error (role status). */
export function AgentDownNotice({ view, onAgain, disabled }: { view: ErrorView; onAgain: () => void; disabled?: boolean }) {
  return (
    <div className="agent-down" data-testid="agent-down" role="status">
      <p><Icon name="alert" /><strong>{view.headline}</strong></p>
      <p className="small">{view.body}</p>
      <button className="btn sm" data-testid="agent-again" disabled={disabled} onClick={onAgain}><Icon name="refresh" />{LABEL["agent-again"].text}</button>
    </div>
  );
}

/**
 * Error copy items 3 and 4, one panel per comp under the verdict: "We couldn't match" with Edit list, and
 * "matches more than one title" with each record (title, year, type) as a button that puts that year on the comp's line.
 */
export function MatchPanels({ comps, onEdit, onPick }: { comps: CompResult[]; onEdit: () => void; onPick: (index: number, o: MatchOption) => void }) {
  const rows = comps.map((c, i) => ({ c, i })).filter(({ c }) => c.match.badge === "Unmatched" || (c.match.options?.length ?? 0) > 1);
  if (!rows.length) return null;
  return (
    <div className="match-panels" data-testid="match-panels">
      {rows.map(({ c, i }) => {
        const v = c.match.badge === "Unmatched" ? unmatched(c.match.input.title) : several(c.match.input.title);
        return (
          <div key={c.key} className="field-error match-panel" role="group" aria-labelledby={`mp-${c.key}`} data-testid="match-panel" data-kind={v.kind}>
            <Icon name={v.kind === "unmatched" ? "x" : "alert"} />
            <div>
              <p><strong id={`mp-${c.key}`} data-testid="match-panel-headline">{v.headline}</strong></p>
              <p data-testid="match-panel-body">{v.body}</p>
              {v.kind === "unmatched" ? (
                <button className="btn sm" data-testid="match-edit" onClick={onEdit}><Icon name={LABEL.edit.icon} />{LABEL.edit.text}</button>
              ) : (
                <ul className="match-options">
                  {c.match.options!.map((o, j) => (
                    <li key={j}><button className="btn sm" data-testid="match-option" onClick={() => onPick(i, o)}>
                      {o.title} <span className="num">({o.year ?? "?"})</span> · {o.type}
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
