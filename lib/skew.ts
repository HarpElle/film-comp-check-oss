import type { DemoQuery } from "./qloo";

export const SKEW_THRESHOLD = 0.3;
const AGE_KEYS = ["24_and_younger", "25_to_29", "45_to_54", "55_and_older"] as const;

/** Gender score = female value. Age score = mean(45_to_54, 55_and_older) - mean(24_and_younger, 25_to_29). */
export function skewScores(q: DemoQuery | undefined): { female?: number; age?: number } {
  if (!q) return {};
  const female = typeof q.gender?.female === "number" ? q.gender.female : undefined;
  const a = q.age ?? {};
  const ok = AGE_KEYS.every((k) => typeof a[k] === "number");
  const age = ok ? (a["45_to_54"]! + a["55_and_older"]!) / 2 - (a["24_and_younger"]! + a["25_to_29"]!) / 2 : undefined;
  return { female, age };
}

export interface SkewInput { key: string; female: number; age: number }

/**
 * Flag at most one comp per deck: the one furthest from the deck mean (distance = larger of the two
 * absolute gaps), and only if that gap is more than 0.3 on either score. Ties go to input order.
 */
export function skewFlag(rows: SkewInput[]): { mean?: { female: number; age: number }; flagged?: { key: string; dFemale: number; dAge: number } } {
  if (!rows.length) return {};
  const mean = { female: rows.reduce((s, r) => s + r.female, 0) / rows.length, age: rows.reduce((s, r) => s + r.age, 0) / rows.length };
  let best: { key: string; dFemale: number; dAge: number; dist: number } | undefined;
  for (const r of rows) {
    const dFemale = r.female - mean.female, dAge = r.age - mean.age;
    const dist = Math.max(Math.abs(dFemale), Math.abs(dAge));
    if (!best || dist > best.dist) best = { key: r.key, dFemale, dAge, dist };
  }
  if (best && best.dist > SKEW_THRESHOLD) return { mean, flagged: { key: best.key, dFemale: best.dFemale, dAge: best.dAge } };
  return { mean };
}

/**
 * Locked audience label rule.
 * distance = max(|age - mean age|, |female - mean female|), mean over all scored comps.
 * k = comps with distance > 0.3. k=0 no outlier; k=1 one outlier with a direction; k>=2 a split, no single outlier.
 */
export type SkewDirection = "an older" | "a younger" | "a more female" | "a more male";
export interface SkewLabel {
  mean?: { female: number; age: number };
  rows: { key: string; dFemale: number; dAge: number; distance: number; standout: boolean }[];
  k: number;
  kind: "none" | "outlier" | "split";
  outlier?: { key: string; dFemale: number; dAge: number; direction: SkewDirection };
  split: string[]; // keys in deck order
}

export function skewDirection(dFemale: number, dAge: number): SkewDirection {
  if (Math.abs(dAge) >= Math.abs(dFemale)) return dAge > 0 ? "an older" : "a younger";
  return dFemale > 0 ? "a more female" : "a more male";
}

export function skewLabel(rows: SkewInput[]): SkewLabel {
  if (!rows.length) return { rows: [], k: 0, kind: "none", split: [] };
  const mean = { female: rows.reduce((s, r) => s + r.female, 0) / rows.length, age: rows.reduce((s, r) => s + r.age, 0) / rows.length };
  const out = rows.map((r) => {
    const dFemale = r.female - mean.female, dAge = r.age - mean.age;
    const distance = Math.max(Math.abs(dFemale), Math.abs(dAge));
    return { key: r.key, dFemale, dAge, distance, standout: distance > SKEW_THRESHOLD };
  });
  const st = out.filter((r) => r.standout);
  const k = st.length;
  if (k === 0) return { mean, rows: out, k, kind: "none", split: [] };
  if (k === 1) return { mean, rows: out, k, kind: "outlier", outlier: { key: st[0].key, dFemale: st[0].dFemale, dAge: st[0].dAge, direction: skewDirection(st[0].dFemale, st[0].dAge) }, split: [] };
  return { mean, rows: out, k, kind: "split", split: st.map((r) => r.key) };
}
