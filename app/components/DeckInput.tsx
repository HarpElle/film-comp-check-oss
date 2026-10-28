import type { ErrorAction, ErrorView } from "@/lib/error-state";
import { DRAFT_SAVED } from "@/lib/draft";
import { parseCompLines } from "@/lib/parse";
import { FieldError } from "./ErrorPanel";
import { Icon } from "./Icon";

/** WP-I: the empty box's placeholder lines (Cmd/Ctrl+Enter submits; the live count shows once there is text). */
const INPUT_PLACEHOLDER = "Get Out | 2017 | Jordan Peele\nMidsommar | 2019 | Ari Aster\nThe Witch | 2015";

/** "Draft saved in this browser." once the box holds the saved draft; "Back to my comps" after a sample replaced it. */
function DraftLine({ saved, canRestore, onRestore }: { saved: boolean; canRestore: boolean; onRestore: () => void }) {
  if (canRestore) return <p className="small draft-line"><button type="button" className="btn link link-hit" data-testid="back-to-draft" onClick={onRestore}>Back to my comps</button></p>;
  return <p className="small muted draft-line" role="status" data-testid="draft-saved">{saved ? DRAFT_SAVED : ""}</p>;
}

export interface DeckInputProps {
  text: string;
  onText: (v: string) => void;
  /** The paused message while live checks are off (own decks can't run), else undefined. */
  paused?: string;
  busy: boolean;
  /** Own deck while live checks are paused: Check comps (and Cmd/Ctrl+Enter) do nothing. */
  blocked: boolean;
  draft: string | null;
  onRestore: () => void;
  /** Results mode: a Close button folds the box away. */
  onClose?: () => void;
  onCheck: () => void;
  fieldError: ErrorView | null;
  onFieldAction: (a: ErrorAction) => void;
}

/** WP-I deck input: the box, its hint and draft line, Check comps with the live count, and the inline field message. */
export function DeckInput({ text, onText, paused, busy, blocked, draft, onRestore, onClose, onCheck, fieldError, onFieldAction }: DeckInputProps) {
  const n = text.trim() ? parseCompLines(text).length : 0;
  return (
    <section className="deck-input" data-testid="deck-input" aria-label="Your comps">
      <label htmlFor="comps"><strong>Your comps</strong> <span className="muted small">(3 to 10 comps; year and director optional)</span></label>
      {paused !== undefined && <p className="paused-note small" data-testid="paused-note" role="note"><Icon name="alert" /><span>{paused} Your own deck can&apos;t be checked until then.</span></p>}
      <textarea id="comps" value={text} onChange={(e) => onText(e.target.value)} spellCheck={false} placeholder={INPUT_PLACEHOLDER}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy && !blocked) onCheck(); } }} aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? "comps-hint field-error" : "comps-hint"} />
      <p className="small muted input-hint" id="comps-hint" data-testid="input-hint">One film per line, like Arrival (2016) or Arrival | 2016 | Villeneuve.</p>
      <DraftLine saved={!!draft && text === draft} canRestore={!!draft && text !== draft} onRestore={onRestore} />
      <div className="actions">
        <button className="btn primary" disabled={busy || blocked} title={blocked ? "Live Qloo checks are paused; the samples still run" : undefined} onClick={onCheck}>{busy ? "Checking..." : "Check comps"}</button>
        {onClose && <button className="btn" disabled={busy} onClick={onClose}>Close</button>}
        {text.trim() && <span className="small muted comp-count" data-testid="comp-count" aria-live="polite">{n} {n === 1 ? "comp" : "comps"}</span>}
      </div>
      {fieldError && <FieldError view={fieldError} on={onFieldAction} />}
    </section>
  );
}
