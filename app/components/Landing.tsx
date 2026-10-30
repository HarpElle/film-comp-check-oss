import { COPY, LANDING } from "@/lib/copy";
import { PENNYWELL } from "@/lib/demo";
import { stampDate } from "@/lib/stamp";
import type { PageStatus } from "@/lib/status";
import type { CompInput } from "@/lib/types";
import { audienceOfLine, lineKind, VerdictIcon } from "./Verdict";

/** Moves focus to the comps box below (UX audit WP-3, 1.6). */
function focusComps() {
  const box = document.getElementById("comps");
  box?.scrollIntoView({ block: "center" });
  box?.focus();
}

/**
 * Landing mode (board R2Landing, UX audit WP-3): the purpose as the h1, how it works, the sample buttons and their note,
 * the recorded sample result, then the two-column about block.
 */
export function Landing({ status, busy, pausedToday, onSample }: { status: PageStatus | null; busy: boolean; pausedToday: boolean; onSample: (comps: CompInput[]) => void }) {
  const dream = status?.samples.find((sm) => sm.id === "dreamhackers");
  return (
    <>
      <section className="hero">
        <div>
          {/* Landing copy, verbatim (lib/copy.ts). The name is in the header and <title>; the h1 says what it does. */}
          <h1 className="purpose" data-testid="purpose">{COPY.purpose}</h1>
          <p className="intro comps-def" data-testid="comps-def">{COPY.compsDef}</p>
          <p className="intro" data-testid="intro">{COPY.sub}</p>
          <ol className="how" aria-label="How it works" data-testid="how">
            {LANDING.how.map((l, i) => <li key={i}><span className="how-n" aria-hidden="true">{i + 1}</span><span>{l}</span></li>)}
          </ol>
          <div className="sample-buttons">
            <button className="btn primary lg sample" disabled={busy} onClick={() => onSample(PENNYWELL)}>{COPY.button}</button>
            {dream && <button className="btn lg sample-2" disabled={busy} data-testid="sample-dreamhackers" onClick={() => onSample(dream.comps)}>{LANDING.dreamButton}</button>}
          </div>
          <p className="small muted sample-note" data-testid="sample-note">{LANDING.sampleNote}</p>
          <p className="own-comps"><button type="button" className="btn link" data-testid="own-comps" onClick={focusComps}>{LANDING.ownComps}</button></p>
        </div>
        {status?.landing && (
          <aside className="sample-verdict" data-testid="sample-verdict" aria-label="Sample result">
            <div className="label">{LANDING.asideLabel(status.landing.deck, status.landing.comps)}</div>
            <ol>{status.landing.verdictLines.map((l, i) => <li key={i} data-testid="sample-verdict-line"><VerdictIcon kind={lineKind(l)} line={l} audience={audienceOfLine(l)} size={14} /><span>{l}</span></li>)}</ol>
            {status.landing.recordedAt && <p className="small muted sample-label" data-testid="landing-sample-label">{LANDING.provenance(stampDate(status.landing.recordedAt))}{pausedToday && <> {LANDING.pausedToday}</>}</p>}
            <button type="button" className="btn link" data-testid="see-full-result" disabled={busy} onClick={() => onSample(PENNYWELL)}>{LANDING.fullResult}</button>
          </aside>
        )}
        {/* WP-11 (9.6): no status yet: hold the aside's room so nothing shifts when it lands. */}
        {!status && <div className="sample-verdict sample-reserve" aria-hidden="true" />}
      </section>
      <section className="folded about" data-testid="about" aria-label="About Film Comp Check">
        <div>
          <h2 className="label">{LANDING.whoLabel}</h2>
          <p data-testid="about-line">{COPY.whoPays}</p>
        </div>
        <div>
          <h2 className="label">{LANDING.differsLabel}</h2>
          <p data-testid="about-line">{COPY.differs}</p>
          <p className="small muted" data-testid="limits-footer">{COPY.limits}</p>
        </div>
      </section>
    </>
  );
}
