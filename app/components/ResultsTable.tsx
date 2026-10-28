import { Fragment, type ReactNode } from "react";
import type { CheckResult, CompInput, CompResult } from "@/lib/types";
import { Badge, Flag } from "./Badge";
import { Icon } from "./Icon";
import { noteId, stepId } from "./linkTarget";
import { RemovedRow } from "./Removal";
import { FIT_WORDS, NOTE_TAG } from "./Steps";
import { compGap } from "@/lib/rank-display";

/** "{rank} of {n} · {gap} below next": the gap is the difference of the two scores as shown (lib/rank-display.ts). */
function rankCell(c: CompResult, comps: CompResult[]): string {
  if (!c.rank) return "";
  const g = compGap(c, comps);
  return `${c.rank.rank} of ${c.rank.of} \u00b7 ${c.rank.gapToNext === undefined ? "top fit" : `${g ?? c.rank.gapToNext.toFixed(3)} below next`}`;
}

const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "\u2212" : "") + Math.abs(v).toFixed(3);

/** Per-comp audience bars (in the detail row): gap from the deck mean on the map's -1..1 scale. */
function Bars({ c, r }: { c: CompResult; r: CheckResult }) {
  const m = r.deckMean;
  if (c.skewUnavailable) return <p className="small muted" data-testid="bars-none">Audience estimate unavailable{c.skew?.error ? `: ${c.skew.error}` : ""}. Left out of the deck average and the audience label; not plotted.</p>;
  if (!m || typeof c.skew?.age !== "number" || typeof c.skew?.female !== "number") return <p className="small muted" data-testid="bars-none">No audience estimate for this comp.</p>;
  const rows: [string, number][] = [["Age gap", c.skew.age - m.age], ["Female gap", c.skew.female - m.female]];
  const kind = c.skewFlag ? "out" : c.skewSplit ? "split" : "";
  return (
    <div data-testid="bars">
      <div className="label" style={{ marginBottom: 4 }}>Audience vs deck average <span style={{ textTransform: "none", letterSpacing: 0 }}>(Qloo&apos;s estimate)</span></div>
      <div className="bars">
        {rows.map(([label, v]) => (
          <Fragment key={label}>
            <span data-testid="bar-label">{label}</span>
            <span className="bar-track" data-testid="bar" data-value={v.toFixed(3)} aria-label={`${label} ${signed(v)}, Qloo's estimate`}>
              <span className={`fill ${kind}`} style={{ left: `${50 + Math.min(0, v) * 50}%`, width: `${Math.abs(v) * 50}%` }} />
              <span className="zero" />
            </span>
            <span className="num" data-testid="bar-value">{signed(v)}{kind === "out" ? " outlier" : kind === "split" ? " split" : ""}</span>
          </Fragment>
        ))}
      </div>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        Age lean <span className="num">{c.skew.age.toFixed(3)}</span>, female lean <span className="num">{c.skew.female.toFixed(3)}</span>; deck average <span className="num">{m.age.toFixed(3)}</span> and <span className="num">{m.female.toFixed(3)}</span>.
        {c.skewFlag && <> <Icon name="users" /> Audience outlier marker, same as its row and map point.</>}
        {c.skewSplit && <> <Icon name="split" /> Audience split marker, same as its row and map point.</>}
      </p>
    </div>
  );
}

export interface ResultsTableProps {
  /** The result on screen, or null while a cold run has none yet (skeleton rows from `pending`). */
  shown: CheckResult | null;
  pending: CompInput[];
  tooFew: boolean;
  showFlags: boolean;
  colCount: number;
  deckOrder: boolean;
  updating: boolean;
  busy: boolean;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
  onRemove: (key: string) => void;
  /** A Remove that is rerunning: its collapsed row stays at its index. */
  removedPending: { title: string; index: number } | null;
  phoneOrder: string[];
  isFlagged: (c: CompResult) => boolean;
  /** The step that added a comp's tag note, and that step's origin, for the note marker. */
  noteStep: (key: string) => number | undefined;
  stepOrigin: (n: number) => string | undefined;
  onStep: (n: number) => void;
}

/** WP-E results table: one row per comp with its detail row (Why lines, popularity, audience bars). */
export function ResultsTable(p: ResultsTableProps) {
  const { shown, tooFew, showFlags, colCount, updating, busy, open, removedPending, phoneOrder, isFlagged, noteStep } = p;
  // While a removal reruns and the new core result has landed, the removed comp's collapsed row stays at its index.
  const withRemoved = (rows: ReactNode[]) => {
    if (!removedPending || !shown || shown.comps.some((c) => c.match.input.title === removedPending.title)) return rows;
    const out = [...rows];
    out.splice(Math.min(removedPending.index, out.length), 0, <RemovedRow key="removed" title={removedPending.title} cols={colCount} order={9998} />);
    return out;
  };
  return (
    <div className="table-scroll" data-testid="table-scroll"><table className={`results${p.deckOrder ? " deck-order" : ""}${updating ? " updating" : ""}`} data-testid="results" aria-busy={busy || undefined}>
      <caption className="sr-only">Comps with Qloo match, fit score, rank and flags</caption>
      <thead>
        <tr><th scope="col">Comp</th><th scope="col">Qloo match</th><th scope="col" className="n">Fit score</th>{!tooFew && <th scope="col" className="rank-th">Rank</th>}{(showFlags || !shown) && <th scope="col">Flags</th>}<th scope="col" className="print-only">Age lean</th><th scope="col" className="print-only">Female lean</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
      </thead>
      <tbody>
        {shown ? withRemoved(shown.comps.map((c) => {
          const m = c.match;
          if (removedPending && m.input.title === removedPending.title) return <RemovedRow key={c.key} title={m.input.title} cols={colCount} order={2 * Math.max(0, phoneOrder.indexOf(c.key))} />;
          const scored = !tooFew && c.fit?.status === "Scored" && typeof c.fit.affinity === "number";
          const accent = !tooFew && c.skewFlag && !(c.considerCutting && c.cutLabel === "Lowest fit, close call");
          const cls = ["comp", !tooFew && c.considerCutting && c.cutLabel === "Consider cutting" ? "cut" : "", accent ? "accent" : "", !tooFew && c.skewSplit ? "split" : "", !tooFew && c.considerCutting ? "lowfit" : "", m.badge === "Unmatched" ? "unmatched" : ""].filter(Boolean).join(" ");
          const isOpen = !!open[c.key];
          const ns = noteStep(c.key);
          return (
            <Fragment key={c.key}>
              <tr className={cls} style={{ ["--o" as string]: 2 * Math.max(0, phoneOrder.indexOf(c.key)) }} data-flagged={isFlagged(c) ? "yes" : "no"} data-accent={accent ? "outlier" : !tooFew && c.skewSplit ? "split" : undefined} data-testid="comp-row" data-title={m.input.title} data-key={c.key}>
                <td>
                  <div className="comp-cell">
                    <button className="comp-title" aria-expanded={isOpen} aria-controls={`detail-${c.key}`} onClick={() => p.onToggle(c.key)} data-testid="comp-toggle">
                      <Icon name={isOpen ? "chevronDown" : "chevronRight"} /><span className="film">{m.input.title}</span>{m.input.year ? <span className="num small muted">{m.input.year}</span> : null}
                    </button>
                    {m.directorInRecord ? <span className="comp-sub" data-testid="director">Dir. {m.directorInRecord}{m.directorFromDeck && <> (record); deck lists {m.directorFromDeck}</>}</span> : m.input.director ? <span className="comp-sub">{m.input.director} (deck)</span> : null}
                  </div>
                </td>
                <td data-label="Qloo match"><div className="match-cell"><Badge kind={m.badge} />{m.badge === "Matched" && <span className="muted small">{m.matchedTitle} <span className="num">{m.matchedYear ?? "?"}</span></span>}</div></td>
                <td className="n" data-label="Fit score" data-testid="score" data-score={scored ? c.fit!.affinity!.toFixed(6) : ""} data-rank={scored && !tooFew ? rankCell(c, shown.comps) || undefined : undefined}>{scored ? <span className="fit-score">{c.fit!.affinity!.toFixed(3)}{updating && <span className="updating-tag"> · updating</span>}</span> : c.fit?.status === "Unscored" ? <Badge kind="Unscored" /> : c.agentStatus === "set_aside" ? <Badge kind="SetAside" /> : m.badge === "Unmatched" ? "" : <Badge kind="NotRun" />}</td>
                {!tooFew && <td className="rank" data-label="Rank" data-testid="rank">{scored ? rankCell(c, shown.comps) : ""}</td>}
                {showFlags && <td className="flags-td" data-label="Flags">
                  <div className="flags-cell">
                    {!tooFew && c.considerCutting && c.cutLabel === "Consider cutting" && <Flag kind="cut" icon="scissors">Consider cutting</Flag>}
                    {!tooFew && c.considerCutting && c.cutLabel === "Lowest fit, close call" && <Flag kind="close" icon="approx">Lowest fit, close call</Flag>}
                    {!tooFew && c.skewFlag && <Flag kind="skew" icon="users">Audience outlier</Flag>}
                    {!tooFew && c.skewSplit && <Flag kind="split" icon="split">Audience split</Flag>}
                    {!tooFew && c.considerCutting && c.leastViewed && <Flag kind="info" icon="down">Also least viewed</Flag>}
                    {m.warning && <Flag kind="warn" icon="warn">Thin record</Flag>}
                    {c.skewUnavailable && <Flag kind="unavail" icon="minus">Audience estimate unavailable</Flag>}
                    {updating && isFlagged(c) && <span className="updating-tag">· updating</span>}
                  </div>
                </td>}
                <td className="print-only num">{typeof c.skew?.age === "number" ? c.skew.age.toFixed(3) : ""}</td>
                <td className="print-only num">{typeof c.skew?.female === "number" ? c.skew.female.toFixed(3) : ""}</td>
                <td className="rm-td"><button className="rm" disabled={busy} onClick={() => p.onRemove(c.key)} aria-label={`Remove ${m.input.title}`} title="Remove and rescore from cached scores"><Icon name="x" /></button></td>
              </tr>
              <tr className="detail" style={{ ["--o" as string]: 2 * Math.max(0, phoneOrder.indexOf(c.key)) + 1 }} id={`detail-${c.key}`} hidden={!isOpen} data-testid="comp-detail" data-title={m.input.title} data-key={c.key}>
                <td colSpan={colCount}>
                  <div className="detail-grid">
                    <div>
                      <div className="label" style={{ marginBottom: 4 }}>Why</div>
                      <ul className="reasons" data-testid="why">{(tooFew ? c.reasons.filter((x) => !FIT_WORDS.test(x) && !/least-viewed/i.test(x)) : c.reasons).map((r, i) => <li key={i} id={r.startsWith("Qloo tags:") ? noteId(c.key) : undefined} data-testid={r.startsWith("Qloo tags:") ? "tag-note" : undefined}>{r}{r.startsWith("Qloo tags:") && ns && <a className="note-marker link-hit" href={`#${stepId(ns)}`} data-testid="note-marker" data-step={ns} onClick={(e) => { e.preventDefault(); p.onStep(ns); }}>{NOTE_TAG[p.stepOrigin(ns) ?? "model"]} · step {ns} {"\u2193"}</a>}</li>)}</ul>
                      <p className="small muted" data-testid="popularity" style={{ margin: "4px 0 0" }}>{typeof c.views?.views === "number" ? `Context only: ${c.views.views.toLocaleString("en-US")} Wikipedia views, last 12 months` : ""}</p>
                    </div>
                    {!tooFew && <Bars c={c} r={shown} />}
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })) : p.pending.map((q, i) => (
          <tr className="comp" key={i} data-testid="skeleton-row">
            <td><div className="comp-cell"><span className="comp-title"><span className="film">{q.title}</span>{q.year ? <span className="num small muted">{q.year}</span> : null}</span></div></td>
            <td><Badge kind="NotRun" /></td><td className="n"><div className="skel" style={{ width: 48, marginLeft: "auto" }} /></td><td><div className="skel" style={{ width: 96 }} /></td><td /><td className="print-only" /><td className="print-only" /><td />
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}
