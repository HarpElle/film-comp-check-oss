import { COPY, FOLDED } from "@/lib/copy";
import { PENNYWELL } from "@/lib/demo";
import { stampDate } from "@/lib/stamp";
import type { PageStatus } from "@/lib/status";
import type { CompInput } from "@/lib/types";
import { Icon, type IconName } from "./Icon";

const verdictIcon = (l: string): IconName => (l.startsWith("Audience outlier") ? "users" : l.startsWith("Audience split") ? "split" : l.startsWith("Consider cutting") || / Consider cutting:/.test(l) ? "scissors" : l.startsWith("Fit ranking") ? "approx" : / of \d+ comps matched/.test(l) ? "check" : "dot");

/** Landing mode (board R2Landing): the hero with the sample buttons, the recorded sample result, the about lines. */
export function Landing({ status, busy, pausedToday, onSample }: { status: PageStatus | null; busy: boolean; pausedToday: boolean; onSample: (comps: CompInput[]) => void }) {
  const dream = status?.samples.find((sm) => sm.id === "dreamhackers");
  return (
    <>
      <section className="hero">
        <div>
          {/* Landing copy, verbatim (lib/copy.ts). */}
          <h1>{COPY.title}</h1>
          <p className="purpose" data-testid="purpose">{COPY.purpose}</p>
          <p className="intro" data-testid="intro">{COPY.sub}</p>
          <div className="sample-buttons">
          <button className="btn primary lg sample" disabled={busy} onClick={() => onSample(PENNYWELL)}><Icon name="play" />{COPY.button}</button>
          {dream && <button className="btn lg sample-2" disabled={busy} data-testid="sample-dreamhackers" onClick={() => onSample(dream.comps)}><Icon name="play" />Try the Dream Hackers sample</button>}
          </div>
        </div>
        {status?.landing && (
          <aside className="sample-verdict" data-testid="sample-verdict" aria-label="Sample result">
            {status.landing.recordedAt && <p className="sample-label" data-testid="landing-sample-label">Sample run, recorded {stampDate(status.landing.recordedAt)}.{pausedToday && <> Live checks are paused for today to stay within our Qloo limit. Try again tomorrow.</>}</p>}
            <div className="label">Sample result: {status.landing.deck} deck, {status.landing.comps} comps</div>
            <ol>{status.landing.verdictLines.map((l, i) => <li key={i} data-testid="sample-verdict-line"><Icon name={verdictIcon(l)} /><span>{l}</span></li>)}</ol>
            {status.landing.recordedAt && <div className="small muted">From a real check on Qloo results recorded {stampDate(status.landing.recordedAt)}.</div>}
          </aside>
        )}
      </section>
      <section className="folded" data-testid="about" aria-label="About Film Comp Check">
        {FOLDED.map((l, i) => <p key={i} data-testid="about-line">{l}</p>)}
      </section>
    </>
  );
}
