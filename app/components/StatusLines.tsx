import type { ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { SAMPLE_QUIET } from "@/lib/messages";
import { recordedStamp } from "@/lib/stamp";
import type { CheckResult } from "@/lib/types";
import { RemovalStatus } from "./Removal";

/** A run time in Chicago time: month, day, time, then "CT". */
export function ct(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
}

function cacheLine(r: CheckResult): string {
  if (r.qlooCalls === 0) return r.cachedAt ? `Qloo results cached at ${ct(r.cachedAt)}. Run again calls Qloo live.` : "No new Qloo calls.";
  const live = `Live: ${r.qlooCalls} Qloo call${r.qlooCalls === 1 ? "" : "s"} just now.`;
  return r.cacheHits > 0 && r.cachedAt ? `${live} The rest were cached at ${ct(r.cachedAt)}. Run again calls Qloo live.` : live;
}

export interface StatusLinesProps {
  shown: CheckResult;
  /** The last finished result (Run again needs one). */
  hasResult: boolean;
  busy: boolean;
  tooFew: boolean;
  /** A Remove that hasn't been undone: the recorded stamp drops its date. */
  removedNow: boolean;
  removal: { title: string; undone?: boolean } | null;
  removalLine: string | null;
  canUndo: boolean;
  onUndo: () => void;
  liveLine: ReactNode;
  /** The recorded sample this deck is, and whether its "Run live on Qloo" gate is open. */
  sampleId?: string;
  liveGateOpen: boolean;
  onRunAgain: () => void;
  onRunLive: () => void;
  pausedLive: boolean;
  repeat: string | null;
  /** Opens the step log at the first chosen step (UX audit WP-6, 2.2). */
  onSteps?: () => void;
}

/** The stamp with its "… chose N of M steps" phrase as a link button to the step log; the text is unchanged. */
function StampText({ stamp, onSteps }: { stamp: string; onSteps?: () => void }) {
  const m = onSteps ? stamp.match(/^(.* \u00b7 )([^\u00b7]+ chose \d+ of \d+ steps)(.*)$/) : null;
  if (!m) return <>{stamp}</>;
  return <>{m[1]}<button type="button" className="btn link stamp-steps" data-testid="stamp-steps" aria-controls="steps-panel" onClick={onSteps}>{m[2]}</button>{m[3]}</>;
}

/** WP-F status lines: the change summary, the live line, line 1 (calls and stamp), current-state lines, line 2. */
export function StatusLines(p: StatusLinesProps) {
  const { shown, busy } = p;
  // The step count is read from the result on screen only once its run is done: while a Remove or Undo reruns, the
  // result on screen is the previous deck's, so its count would be the parent run's, not the replay being loaded.
  const stamp = recordedStamp(shown, { steps: !p.tooFew && !busy, date: !p.removedNow });
  const quiet = !!p.sampleId && !busy && !p.liveGateOpen;
  return (
    <div className="status" data-testid="status-lines">
      {p.removal && p.removalLine && <RemovalStatus line={p.removalLine} title={p.removal.title} canUndo={p.canUndo} onUndo={p.onUndo} />}
      {busy && <div data-testid="busy">{p.liveLine}</div>}
      {stamp
        ? <p className="muted"><span data-testid="calls">No new Qloo calls.</span> <span data-testid="recorded-stamp"><StampText stamp={stamp} onSteps={busy ? undefined : p.onSteps} />.</span>
          {/* Only one of the replay "Run again" link and the quiet line renders (the quiet line already says "Run again"). */}
          {!quiet && <>{" "}<button className="btn link run-live no-print" data-testid="replay-again" disabled={busy || !p.hasResult} onClick={p.onRunAgain}>Run again</button></>}
          {p.sampleId && !busy && (quiet
            ? <>{" "}<span data-testid="sample-quiet-line">{SAMPLE_QUIET}</span></>
            : <>{" "}<button className="btn link no-print" data-testid="run-live-qloo" disabled={busy} onClick={p.onRunLive} title="Runs this sample with live Qloo calls and compares the fit scores with the recording">Run live on Qloo</button></>)}</p>
        : <p className="muted"><span data-testid="calls">{cacheLine(shown)}</span> <button className="btn link run-live no-print" disabled={busy || !p.hasResult} onClick={p.onRunAgain} title="Fetch fresh results instead of cached ones">Run again</button></p>}
      {p.pausedLive && <p className="small muted" data-testid="paused-live">Live checks are paused for today to stay within our Qloo limit. Try again tomorrow.</p>}
      {p.repeat && !busy && <p className="muted" data-testid="repeat-check">{p.repeat}</p>}
      {shown.notes.map((n, i) => <p key={i} className="muted">{n}</p>)}
      <p className="status-line-2" data-testid="limits-footer">{COPY.limits}</p>
    </div>
  );
}

/** Cold run: the status lines stand where the finished ones will (WP-F: line 2 always), line 1 live with Stop. */
export function ColdStatusLines({ liveLine }: { liveLine: ReactNode }) {
  return (
    <div className="status" data-testid="status-lines">
      <div data-testid="busy">{liveLine}</div>
      <p className="status-line-2" data-testid="limits-footer">{COPY.limits}</p>
    </div>
  );
}
