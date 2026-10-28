import type { ReactNode } from "react";
import type { CheckResult } from "@/lib/types";
import { Icon } from "./Icon";

/**
 * Verdict block. Three computed verdict lines at 20 px, each led by an 18 px icon; the
 * audience line is weight 600. Wording is exactly the computed verdictLines (only the count line is the
 * page's own "n of m comps matched." count, as before). No visible "Verdict" label: the heading is sr-only.
 */
export type LineKind = "matched" | "audience" | "fit" | "other";
export function lineKind(l: string): LineKind {
  if (/ of \d+ comps matched\./.test(l)) return "matched";
  if (/^(Audience outlier|Audience split|No audience outlier|Audience)/.test(l)) return "audience";
  if (/^(Fit ranking|Consider cutting|Lowest fit)/.test(l) || / Consider cutting:/.test(l)) return "fit";
  return "other";
}
export type AudienceKind = "outlier" | "split" | "none";
export const audienceKind = (r: CheckResult): AudienceKind => (r.comps.some((c) => c.skewFlag) ? "outlier" : r.comps.some((c) => c.skewSplit) ? "split" : "none");

/** Numbers inside the fit line render in mono. */
function monoNumbers(l: string): ReactNode[] {
  return l.split(/(\d+\.\d+)/).map((part, i) => (i % 2 ? <span key={i} className="fcc-num">{part}</span> : part));
}

export function VerdictIcon({ kind, line, audience }: { kind: LineKind; line: string; audience: AudienceKind }) {
  if (kind === "matched") return <span className="v-icon v-matched" data-icon-kind="check"><Icon name="check" size={18} /></span>;
  if (kind === "audience") {
    if (audience === "outlier") return <span className="v-icon v-chip v-chip-outlier" data-icon-kind="outlier-chip"><Icon name="users" size={14} /></span>;
    if (audience === "split") return <span className="v-icon v-chip v-chip-split" data-icon-kind="split-chip"><Icon name="split" size={14} /></span>;
    return <span className="v-icon v-muted" data-icon-kind="users"><Icon name="users" size={18} /></span>;
  }
  if (kind === "fit") {
    const cut = /Consider cutting/.test(line);
    return <span className="v-icon v-muted" data-icon-kind={cut ? "scissors" : "circle-help"}><Icon name={cut ? "scissors" : "circleHelp"} size={18} /></span>;
  }
  return <span className="v-icon v-muted" data-icon-kind="dot"><Icon name="dot" size={18} /></span>;
}

export function VerdictLines({ lines, r, countLine }: { lines: string[]; r: CheckResult; countLine: string }) {
  const aud = audienceKind(r);
  return (
    <ol className="verdict-lines">
      {lines.map((l, i) => {
        const kind = lineKind(l);
        const text = kind === "matched" ? countLine : l;
        return (
          <li key={i} data-testid="verdict-line" data-kind={kind} className={`verdict-line vl-${kind}`}>
            <VerdictIcon kind={kind} line={l} audience={aud} />
            <span className="v-text">{kind === "fit" ? monoNumbers(text) : text}</span>
          </li>
        );
      })}
    </ol>
  );
}
