import { liveCompareLabel, liveCompareSummary, signedDiff } from "@/lib/compare";
import { SAMPLE_QUIET_AFTER_LIVE } from "@/lib/messages";
import type { CheckResult } from "@/lib/types";

/** After "Run live on Qloo": the live fit scores against the recording (or the first live run), and the next step. */
export function LiveCompare({ shown, secondOpen, onSecond }: { shown: CheckResult; secondOpen: boolean; onSecond: () => void }) {
  const ls = shown.liveSample!, cmp = ls.compare!, before = cmp.kind === "recording" ? "Recording" : "First live run";
  return (
    <section className="live-compare" data-testid="live-compare" aria-label="Live run comparison">
      <p className="small" data-testid="live-compare-label"><strong>{liveCompareLabel(cmp)}</strong></p>
      <p className="small" data-testid="live-compare-summary">{liveCompareSummary(cmp, 3)}</p>
      <table className="results compact">
        <thead><tr><th>Comp</th><th className="n">{cmp.kind === "recording" ? "Live" : "Second live run"}</th><th className="n">{before}</th><th className="n">Difference</th><th>6 decimals</th></tr></thead>
        <tbody>{cmp.rows.map((r) => (
          <tr key={r.title} data-testid="live-compare-row" data-title={r.title} data-same6={r.same6 ? "yes" : "no"} data-diff6={r.diff === undefined ? "" : r.diff.toFixed(6)}>
            <td>{r.title}</td><td className="n num">{r.now?.toFixed(3) ?? ""}</td><td className="n num">{r.before?.toFixed(3) ?? ""}</td><td className="n num" data-testid="live-compare-diff">{r.diff === undefined ? "" : signedDiff(r.diff, 3)}</td><td>{r.diff === undefined ? "no score" : r.same6 ? "matched" : "differs"}</td>
          </tr>))}</tbody>
      </table>
      {!ls.second && (secondOpen
        ? <p className="small"><button className="btn link no-print" data-testid="run-live-second" onClick={onSecond}>Run live again</button> <span className="muted">A second live run, compared with this one.</span></p>
        : <p className="small muted" data-testid="sample-quiet-line">{SAMPLE_QUIET_AFTER_LIVE}</p>)}
    </section>
  );
}
