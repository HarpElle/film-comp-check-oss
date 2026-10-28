"use client";
import { useEffect, useState } from "react";
import { SKEW_THRESHOLD } from "@/lib/skew";
import type { CheckResult } from "@/lib/types";
import { MAP } from "./mapGeometry";

/**
 * DeckMap. Inline SVG 344x314; plot square 288x288 at (48, 4); both axes -1..1 at
 * 144 px per unit. x = female lean (more male left, more female right), y = age lean (older up).
 * Reads only computed values (comps[].skew, deckMean, SKEW_THRESHOLD, skewFlag, skewSplit); computes only
 * pixel positions. Labels on flagged comps only; unflagged comps are named by their <title> on hover.
 */
const { W, H, L, T, P, U } = MAP;
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
export const px = (f: number) => L + U * (clamp(f) + 1);
export const py = (a: number) => T + U * (1 - clamp(a));

type Flag = "outlier" | "split";
export interface Pt { key: string; title: string; x: number; y: number; flag?: Flag }
export type Box = { x: number; y: number; w: number; h: number };
const FLAG_WORD: Record<Flag, string> = { outlier: "Audience outlier", split: "Audience split" };
const NAME_H = 13, TAG_H = 11, LINE_GAP = 2, PAD = 4;
const markerHalf = (p: Pt) => (p.flag === "outlier" ? 6.75 : p.flag === "split" ? 9.75 : 5);
/** Width estimates (wide on purpose) until the real fonts are measured in the browser. */
const estimate = (t: string, kind: "name" | "tag") => Math.ceil(t.length * (kind === "name" ? 6.6 : 6.4));

export interface Placed { key: string; side: "right" | "left" | "above" | "below"; box: Box; anchor: "start" | "end" | "middle"; tx: number }
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Spec order: right of the point, else left, else above. Below is the last resort. */
export function placeLabels(flagged: Pt[], all: Pt[], bounds: Box, obstacles: Box[], width: (p: Pt) => number): Placed[] {
  const markers = all.map((p) => { const r = markerHalf(p); return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r }; });
  const out: Placed[] = [], taken: Box[] = [];
  for (const p of flagged) {
    const w = width(p), h = NAME_H + LINE_GAP + TAG_H, r = markerHalf(p);
    const opts: Placed[] = [
      { key: p.key, side: "right", box: { x: p.x + r + PAD, y: p.y - NAME_H, w, h }, anchor: "start", tx: p.x + r + PAD },
      { key: p.key, side: "left", box: { x: p.x - r - PAD - w, y: p.y - NAME_H, w, h }, anchor: "end", tx: p.x - r - PAD },
      { key: p.key, side: "above", box: { x: p.x - w / 2, y: p.y - r - PAD - h, w, h }, anchor: "middle", tx: p.x },
      { key: p.key, side: "below", box: { x: p.x - w / 2, y: p.y + r + PAD, w, h }, anchor: "middle", tx: p.x },
    ];
    const inside = (o: Placed) => o.box.x >= bounds.x && o.box.y >= bounds.y && o.box.x + o.box.w <= bounds.x + bounds.w && o.box.y + o.box.h <= bounds.y + bounds.h;
    // Cost: 0 when clear. Other markers and labels weigh most, box edges and notes least; off-plot is never chosen when anything fits.
    const cost = (o: Placed) => (inside(o) ? 0 : 1000) + 10 * markers.filter((m) => hit(m, o.box)).length + 10 * taken.filter((b) => hit(b, o.box)).length + obstacles.filter((b) => hit(b, o.box)).length;
    const pick = opts.reduce((best, o) => (cost(o) < cost(best) ? o : best), opts[0]);
    out.push(pick); taken.push(pick.box);
  }
  return out;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function DeckMap({ r, updating = false }: { r: CheckResult; updating?: boolean }) {
  const m = r.deckMean;
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const all: (Pt & { f: number; a: number })[] = [];
  for (const c of r.comps) {
    if (typeof c.skew?.age !== "number" || typeof c.skew?.female !== "number" || c.match.badge !== "Matched") continue;
    all.push({ key: c.key, title: c.match.matchedTitle ?? c.match.input.title, f: c.skew.female, a: c.skew.age, x: px(c.skew.female), y: py(c.skew.age), flag: c.skewFlag ? "outlier" : c.skewSplit ? "split" : undefined });
  }
  const flagged = all.filter((p) => p.flag);
  const sig = flagged.map((p) => p.title).join("|");
  // Measure the real label widths once the self-hosted fonts are ready, then place again.
  useEffect(() => {
    let live = true;
    const run = () => {
      const ctx = document.createElement("canvas").getContext("2d"); if (!ctx) return;
      const res: Record<string, number> = {};
      for (const p of flagged) {
        ctx.font = `600 13px "IBM Plex Sans Condensed"`; const n = ctx.measureText(p.title).width;
        ctx.font = `600 11px "Inter"`; const t = ctx.measureText(FLAG_WORD[p.flag!]).width;
        res[p.key] = Math.ceil(Math.max(n, t)) + 2;
      }
      if (live) setMeasured(res);
    };
    (document.fonts?.ready ?? Promise.resolve()).then(run);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const half = SKEW_THRESHOLD * U;
  const cx = m ? px(m.female) : 0, cy = m ? py(m.age) : 0;
  const box: Box = { x: cx - half, y: cy - half, w: 2 * half, h: 2 * half };
  const thr = String(SKEW_THRESHOLD);
  const avgLabel: Box = { x: L + P - 4 - 66, y: cy - 4 - 10, w: 66, h: 11 };
  const pmLabel: Box = { x: box.x + box.w + 3, y: box.y + box.h + 1, w: 30, h: 11 };
  const width = (p: Pt) => measured[p.key] ?? Math.max(estimate(p.title, "name"), estimate(FLAG_WORD[p.flag!], "tag"));
  // The box edges count as marks to avoid (WP-E2 "avoid other marks"); 1 px strips along each side.
  const edges: Box[] = m ? [{ ...box, h: 1 }, { ...box, y: box.y + box.h - 1, h: 1 }, { ...box, w: 1 }, { ...box, x: box.x + box.w - 1, w: 1 }] : [];
  const placed = new Map(placeLabels(flagged, all, { x: L, y: T, w: P, h: P }, m ? [avgLabel, pmLabel, ...edges] : [], width).map((q) => [q.key, q]));

  const outside = all.filter((p) => p.flag);
  const where = (p: (typeof all)[number]) => {
    if (!m) return "";
    const dA = p.a - m.age, dF = p.f - m.female;
    return Math.abs(dA) >= Math.abs(dF) ? (dA > 0 ? "above it, older than the deck" : "below it, younger than the deck") : (dF > 0 ? "right of it, more female than the deck" : "left of it, more male than the deck");
  };
  const aria = [
    `Audience lean of the ${word(all.length)} comps, Qloo's estimate, both axes from −1 to 1.`,
    m ? `${cap(word(all.length - outside.length))} comp${all.length - outside.length === 1 ? "" : "s"} sit${all.length - outside.length === 1 ? "s" : ""} inside the box of deck average ± ${thr}.` : "",
    ...outside.map((p) => `${p.title} sits ${where(p)}: ${FLAG_WORD[p.flag!].toLowerCase()}.`),
  ].filter(Boolean).join(" ");

  return (
    <figure className={`deckmap${updating ? " updating" : ""}`} data-testid="deck-map" aria-busy={updating || undefined}>
      <figcaption className="fcc-label deckmap-caption" data-testid="map-caption">Audience lean · Qloo&apos;s estimate{updating && <span className="updating-tag"> · Updating</span>}</figcaption>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} data-testid="map-svg">
        <rect data-testid="map-plot" x={L} y={T} width={P} height={P} className="map-frame" />
        {m && (
          <g data-testid="map-mean" data-cx={cx} data-cy={cy}>
            <line x1={cx} x2={cx} y1={T} y2={T + P} className="map-cross" data-testid="map-cross-v" />
            <line x1={L} x2={L + P} y1={cy} y2={cy} className="map-cross" data-testid="map-cross-h" />
            <text className="map-note" x={L + P - 4} y={cy - 4} textAnchor="end" data-testid="map-avg-label">deck average</text>
            <rect data-testid="map-box" data-threshold={SKEW_THRESHOLD} x={box.x} y={box.y} width={box.w} height={box.h} className="map-box" />
            <text className="map-note" x={pmLabel.x} y={pmLabel.y + 9} data-testid="map-box-label">± {thr}</text>
          </g>
        )}
        {all.map((p) => {
          const q = placed.get(p.key);
          return (
            <g key={p.key} data-testid="map-point" data-cx={p.x} data-cy={p.y} data-title={p.title} data-flag={p.flag ?? "none"} data-side={q?.side}>
              <title>{p.title}{p.flag ? `: ${FLAG_WORD[p.flag].toLowerCase()}` : ""}</title>
              {p.flag === "outlier" ? (
                <rect data-testid="map-marker" data-shape="square" x={p.x - 6} y={p.y - 6} width={12} height={12} className="map-outlier" />
              ) : (
                <>
                  <circle data-testid="map-marker" data-shape="dot" cx={p.x} cy={p.y} r={5} className="map-dot" />
                  {p.flag === "split" && <circle data-testid="map-ring" cx={p.x} cy={p.y} r={9} className="map-ring" />}
                </>
              )}
              {q && (
                <g data-testid="map-label-group">
                  <text className="map-name map-halo" aria-hidden="true" x={q.tx} y={q.box.y + NAME_H - 2} textAnchor={q.anchor}>{p.title}</text>
                  <text className="map-name" x={q.tx} y={q.box.y + NAME_H - 2} textAnchor={q.anchor} data-testid="map-label">{p.title}</text>
                  <text className={`map-flag map-halo`} aria-hidden="true" x={q.tx} y={q.box.y + NAME_H + LINE_GAP + TAG_H - 2} textAnchor={q.anchor}>{FLAG_WORD[p.flag!]}</text>
                  <text className={`map-flag ${p.flag}`} x={q.tx} y={q.box.y + NAME_H + LINE_GAP + TAG_H - 2} textAnchor={q.anchor} data-testid="map-flag">{FLAG_WORD[p.flag!]}</text>
                </g>
              )}
            </g>
          );
        })}
        <Axes />
      </svg>
      {!!r.audience?.unavailable.length && <p className="map-not-plotted" data-testid="map-not-plotted">Not plotted: {r.audience.unavailable.join(", ")} (no estimate)</p>}
    </figure>
  );
}

function Axes() {
  return (
    <>
      <text className="map-tick" x={L} y={T + P + 14} textAnchor="middle">−1</text>
      <text className="map-tick" x={L + P} y={T + P + 14} textAnchor="middle">1</text>
      <text className="map-tick" x={L - 4} y={T + P} textAnchor="end">−1</text>
      <text className="map-tick" x={L - 4} y={T + 9} textAnchor="end">1</text>
      <text className="map-axis" x={L + P / 2} y={T + P + 14} textAnchor="middle" data-testid="map-x-title">more male ← <tspan className="map-axis-name">Female lean</tspan> → more female</text>
      <text className="map-axis" transform={`translate(14 ${T + P / 2}) rotate(-90)`} textAnchor="middle" data-testid="map-y-title">younger ← <tspan className="map-axis-name">Age lean</tspan> → older</text>
    </>
  );
}

/**
 * Cold-run skeleton (WP-F, board States): the map's frame, axes and ± threshold box, no dots. The box sits at the
 * plot's center until a deck average exists. Same caption and SVG size as the finished map, so nothing moves when it lands.
 */
export function DeckMapSkeleton({ note }: { note: string }) {
  const half = SKEW_THRESHOLD * U, c = px(0);
  return (
    <figure className="deckmap skeleton" data-testid="map-placeholder" data-skeleton="1" aria-busy="true">
      <figcaption className="fcc-label deckmap-caption">Audience lean · Qloo&apos;s estimate</figcaption>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" data-testid="map-skeleton">
        <rect x={L} y={T} width={P} height={P} className="map-frame" data-testid="map-skeleton-frame" />
        <rect x={c - half} y={py(0) - half} width={2 * half} height={2 * half} className="map-box" data-testid="map-skeleton-box" />
        <Axes />
      </svg>
      <p className="sr-only">{note}</p>
    </figure>
  );
}
