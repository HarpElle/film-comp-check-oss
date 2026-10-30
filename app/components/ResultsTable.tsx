import { Fragment, type ReactNode } from "react";
import type { CheckResult, CompInput, CompResult } from "@/lib/types";
import { Badge, Flag } from "./Badge";
import { Icon, type IconName } from "./Icon";
import { focusLinkTarget, noteId, stepId } from "./linkTarget";
import { RemovedRow } from "./Removal";
import { pointSentence } from "./DeckMap";
import { FIT_WORDS, NOTE_TAG } from "./Steps";
import { compGap } from "@/lib/rank-display";
import { NEXT_STEP, TABLE } from "@/lib/copy";
import { cutOf, skewOf } from "@/lib/change-summary";

/** "{rank} of {n} · {gap} below next": the gap is the difference of the two scores as shown (lib/rank-display.ts). */
function rankCell(c: CompResult, comps: CompResult[]): string {
  if (!c.rank) return "";
  const g = compGap(c, comps);
  return `${c.rank.rank} of ${c.rank.of} \u00b7 ${c.rank.gapToNext === undefined ? "top fit" : `${g ?? c.rank.gapToNext.toFixed(3)} below next`}`;
}

/**
 * The row's own reason for a flag (UX audit WP-2, 2.1): the Why line that starts with the flag label, with the label and
 * its ": " removed (first letter capitalized), verbatim otherwise. Existing strings only; nothing is computed here.
 */
export function flagReason(c: CompResult, label: string): string | undefined {
  const r = c.reasons.find((x) => x.startsWith(`${label}: `));
  if (!r) return undefined;
  // The next-step line under the flag replaces a bare "Check it." (approved Oct 30); the Why line keeps it.
  const t = r.slice(label.length + 2).replace(/\s*Check it\.\s*$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const whyId = (key: string) => `why-${key}-0`;

/** "{matchedTitle} {matchedYear}" under the badge only when the record differs from what the deck typed (WP-2, 5.1). */
const recordDiffers = (m: CompResult["match"]) =>
  !!m.matchedTitle && (m.matchedTitle.toLowerCase() !== m.input.title.toLowerCase() || (m.input.year !== undefined && m.matchedYear !== m.input.year));

/** A computed value to 3 decimals with a real minus sign (U+2212) when negative; the value itself is unchanged. */
const minus = (v: number) => { const s = v.toFixed(3); return s.startsWith("-") ? `\u2212${s.slice(1)}` : s; };
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
            <span className="bar-track" role="img" data-testid="bar" data-value={v.toFixed(3)} aria-label={`${label} ${signed(v)}, Qloo's estimate`}>
              <span className={`fill ${kind}`} style={{ left: `${50 + Math.min(0, v) * 50}%`, width: `${Math.abs(v) * 50}%` }} />
              <span className="zero" />
            </span>
            <span className="num" data-testid="bar-value" aria-hidden="true">{signed(v)}{kind === "out" ? " outlier" : kind === "split" ? " split" : ""}</span>
          </Fragment>
        ))}
      </div>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        Age lean <span className="num">{minus(c.skew.age)}</span>, female lean <span className="num">{minus(c.skew.female)}</span>; deck average <span className="num">{minus(m.age)}</span> and <span className="num">{minus(m.female)}</span>.
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
  /** After a finished Remove (not undone): the result before it, for the "was" lines, and the kept removed row. */
  removed?: { before: CheckResult; title: string; index: number; onUndo: () => void } | null;
  /** Row ↔ map point link (UX audit WP-8): the comp a row or a point is under the pointer or focus. */
  hoverKey?: string | null;
  onHover?: (key: string | null) => void;
}

/** A row's computed flag labels, as one string (for the "was" line after a Remove). */
const flagLabelOf = (c: CompResult) => [cutOf(c), skewOf(c)].filter(Boolean).join(", ") || undefined;

/** WP-E results table: one row per comp with its detail row (Why lines, popularity, audience bars). */
export function ResultsTable(p: ResultsTableProps) {
  const { shown, tooFew, showFlags, colCount, updating, busy, open, removedPending, phoneOrder, isFlagged, noteStep, removed } = p;
  // UX audit WP-5: after a Remove, the removed comp keeps a collapsed row (with Undo) at its index.
  const keptRow = removed && !busy ? { title: removed.title, index: removed.index } : null;
  // While a removal reruns and the new core result has landed, the removed comp's collapsed row stays at its index.
  const withRemoved = (rows: ReactNode[]) => {
    const r = removedPending ?? keptRow;
    if (!r || !shown || shown.comps.some((c) => c.match.input.title === r.title)) return rows;
    const out = [...rows];
    out.splice(Math.min(r.index, out.length), 0, <RemovedRow key="removed" title={r.title} cols={colCount} order={9998} onUndo={keptRow ? removed!.onUndo : undefined} />);
    return out;
  };
  return (
    <div className="table-scroll" data-testid="table-scroll"><table className={`results${p.deckOrder ? " deck-order" : ""}${updating ? " updating" : ""}`} data-testid="results" aria-busy={busy || undefined}>
      <caption className="sr-only">Comps with Qloo match, fit score, rank and flags</caption>
      <thead>
        <tr><th scope="col">Comp</th><th scope="col">Qloo match</th><th scope="col" className="n">{tooFew ? "Fit score" : <>Fit<span className="fit-rank-th">{" \u00b7 rank"}</span></>}</th>{!tooFew && <th scope="col" className="rank-th">Rank</th>}{(showFlags || !shown) && <th scope="col">Flags</th>}<th scope="col" className="print-only">Age lean</th><th scope="col" className="print-only">Female lean</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
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
          const mapWords = tooFew ? undefined : pointSentence(c, shown.deckMean);
          // "was" lines (WP-5): the earlier computed values, shown beside the new ones; nothing is subtracted.
          const was = removed && !busy ? removed.before.comps.find((b) => b.match.input.title === m.input.title && (b.match.input.year ?? null) === (m.input.year ?? null)) : undefined;
          const wasScore = was && typeof was.fit?.affinity === "number" && scored && was.fit.affinity.toFixed(3) !== c.fit!.affinity!.toFixed(3) ? was.fit.affinity.toFixed(3) : undefined;
          const wasFlag = was && !tooFew && flagLabelOf(was) !== flagLabelOf(c) ? flagLabelOf(was) ?? "no flag" : undefined;
          // Pill flags (DS RowFlag), each with its own reason line; quiet text flags stay plain.
          const next: Record<string, string> = { cut: NEXT_STEP.lowFit, close: NEXT_STEP.lowFit, skew: NEXT_STEP.skew, split: NEXT_STEP.split };
          const pills: [string, IconName, string][] = tooFew ? [] : [
            ...(c.considerCutting && c.cutLabel === "Consider cutting" ? [["cut", "scissors", "Consider cutting"] as [string, IconName, string]] : []),
            ...(c.considerCutting && c.cutLabel === "Lowest fit, close call" ? [["close", "circleHelp", "Lowest fit, close call"] as [string, IconName, string]] : []),
            ...(c.skewFlag ? [["skew", "users", "Audience outlier"] as [string, IconName, string]] : []),
            ...(c.skewSplit ? [["split", "split", "Audience split"] as [string, IconName, string]] : []),
          ];
          const quiet = pills.length === 0 && !(!tooFew && c.considerCutting && c.leastViewed) && !m.warning && !c.skewUnavailable;
          return (
            <Fragment key={c.key}>
              <tr className={`${cls}${p.hoverKey === c.key ? " hovered" : ""}`} style={{ ["--o" as string]: 2 * Math.max(0, phoneOrder.indexOf(c.key)) }}
                onMouseEnter={p.onHover && (() => p.onHover!(c.key))} onMouseLeave={p.onHover && (() => p.onHover!(null))} onFocus={p.onHover && (() => p.onHover!(c.key))} onBlur={p.onHover && (() => p.onHover!(null))} data-flagged={isFlagged(c) ? "yes" : "no"} data-accent={accent ? "outlier" : !tooFew && c.skewSplit ? "split" : undefined} data-testid="comp-row" data-title={m.input.title} data-key={c.key}>
                <td>
                  <div className="comp-cell">
                    <button className="comp-title" aria-expanded={isOpen} aria-controls={`detail-${c.key}`} aria-describedby={mapWords ? `map-words-${c.key}` : undefined} onClick={() => p.onToggle(c.key)} data-testid="comp-toggle">
                      <Icon name={isOpen ? "chevronDown" : "chevronRight"} /><span className="film">{m.input.title}</span>{m.input.year ? <>{" "}<span className="num small muted">{m.input.year}</span></> : null}
                    </button>
                    {mapWords && <span className="sr-only" id={`map-words-${c.key}`}>{mapWords}</span>}
                    {m.directorInRecord ? <span className="comp-sub" data-testid="director">Dir. {m.directorInRecord}{m.directorFromDeck && <> (record); deck lists {m.directorFromDeck}</>}</span> : m.input.director ? <span className="comp-sub">{m.input.director} (deck)</span> : null}
                  </div>
                </td>
                <td data-label="Qloo match"><div className="match-cell"><Badge kind={m.badge} />{m.badge === "Matched" && recordDiffers(m) && <span className="muted small" data-testid="record-line">{m.matchedTitle} <span className="num">{m.matchedYear ?? "?"}</span></span>}</div></td>
                <td className="n" data-label="Fit score" data-testid="score" data-score={scored ? c.fit!.affinity!.toFixed(6) : ""} data-rank={scored && !tooFew ? rankCell(c, shown.comps) || undefined : undefined}>{scored && <span className={`fit-score${wasScore ? " changed" : ""}`}>{c.fit!.affinity!.toFixed(3)}{updating && <span className="updating-tag"> · updating</span>}</span>}{scored && wasScore && <span className="was num" data-testid="was-score">{`${TABLE.was} ${wasScore}`}</span>}{scored ? null : c.fit?.status === "Unscored" ? <Badge kind="Unscored" /> : c.agentStatus === "set_aside" ? <Badge kind="SetAside" /> : m.badge === "Unmatched" ? "" : <Badge kind="NotRun" />}</td>
                {!tooFew && <td className="rank" data-label="Rank" data-testid="rank">{scored ? rankCell(c, shown.comps) : ""}</td>}
                {showFlags && <td className="flags-td" data-label="Flags">
                  <div className={`flags-cell${wasFlag ? " changed" : ""}`}>
                    {pills.map(([kind, icon, label], i) => {
                      const why = flagReason(c, label);
                      // After the last pill: "Why ↓" opens the detail (the tag note lives there, with the other Why lines).
                      const end = i === pills.length - 1 && <>
                        <button className="btn link why-link no-print" aria-controls={`detail-${c.key}`} aria-expanded={isOpen} data-testid="why-link"
                          onClick={() => { p.onToggle(c.key); if (!isOpen) focusLinkTarget(whyId(c.key)); }}>{TABLE.why}</button></>;
                      return (
                        <div className="flag-item" key={kind}>
                          <Flag kind={kind} icon={icon}>{label}</Flag>
                          {/* The reason, then what to do (darker), as one paragraph. */}
                          <span className="flag-why">{why && <span data-testid="flag-why">{why} </span>}<span className="flag-next" data-testid="flag-next">{next[kind]}</span>{end && <>{" "}{end}</>}</span>
                        </div>
                      );
                    })}
                    {!tooFew && c.considerCutting && c.leastViewed && <div className="flag-item"><Flag kind="info" icon="down">Also least viewed</Flag><span className="flag-next" data-testid="flag-next">{NEXT_STEP.leastViewed}</span></div>}
                    {m.warning && <div className="flag-item"><Flag kind="warn" icon="warn">Thin Qloo record</Flag><span className="flag-next" data-testid="flag-next">{NEXT_STEP.thin}</span></div>}
                    {c.skewUnavailable && <div className="flag-item"><Flag kind="unavail" icon="minus">Audience estimate unavailable</Flag><span className="flag-next" data-testid="flag-next">{NEXT_STEP.unavailable}</span></div>}
                    {wasFlag && <span className="was" data-testid="was-flag">{`${TABLE.was} ${wasFlag}`}</span>}
                    {quiet && <span className="no-flag"><span aria-hidden="true">{"\u2014"}</span><span className="sr-only">No flags</span></span>}
                    {updating && isFlagged(c) && <span className="updating-tag">· updating</span>}
                  </div>
                </td>}
                <td className="print-only num">{typeof c.skew?.age === "number" ? minus(c.skew.age) : ""}</td>
                <td className="print-only num">{typeof c.skew?.female === "number" ? minus(c.skew.female) : ""}</td>
                <td className="rm-td"><button className="rm" disabled={busy} onClick={() => p.onRemove(c.key)} aria-label={`Remove ${m.input.title}`}><Icon name="x" /><span className="rm-lbl">Remove</span></button></td>
              </tr>
              <tr className="detail" style={{ ["--o" as string]: 2 * Math.max(0, phoneOrder.indexOf(c.key)) + 1 }} id={`detail-${c.key}`} hidden={!isOpen} data-testid="comp-detail" data-title={m.input.title} data-key={c.key}>
                <td colSpan={colCount}>
                  <div className="detail-grid">
                    <div>
                      <div className="label" style={{ marginBottom: 4 }}>Why</div>
                      <ul className="reasons" data-testid="why">{(tooFew ? c.reasons.filter((x) => !FIT_WORDS.test(x) && !/least-viewed/i.test(x)) : c.reasons).map((r, i) => <li key={i} id={r.startsWith("Qloo tags:") ? noteId(c.key) : i === 0 ? whyId(c.key) : undefined} data-testid={r.startsWith("Qloo tags:") ? "tag-note" : undefined}>{r}{r.startsWith("Qloo tags:") && ns && <a className="note-marker link-hit" href={`#${stepId(ns)}`} data-testid="note-marker" data-step={ns} onClick={(e) => { e.preventDefault(); p.onStep(ns); }}>{NOTE_TAG[p.stepOrigin(ns) ?? "model"]} · step {ns} {"\u2193"}</a>}</li>)}</ul>
                      <p className="small muted" data-testid="popularity" style={{ margin: "4px 0 0" }}>{typeof c.views?.views === "number" ? TABLE.views(c.views.views.toLocaleString("en-US")) : ""}</p>
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
