import { MIN_MATCHED_FOR_FIT } from "./limits";
import { recordedStamp, sampleLabel, stampDate } from "./stamp";
import { liveCompareLabel, liveCompareSummary } from "./compare";
import { AUDIENCE_COLUMNS, FIXED_LINE, type CheckResult } from "./types";
import { compGap, withShownGaps } from "./rank-display";

const EST = " (Qloo's estimate)";
/** The Markdown audience table's columns, in plain words (the section heading says "Qloo's estimate" once). */
const MD_AUDIENCE: [(typeof AUDIENCE_COLUMNS)[number][0], string][] = [
  ["female", "Female lean"], ["age", "Age lean"], ["dAge", "Age gap from deck average"], ["dFemale", "Female gap from deck average"], ["ageDirection", "Older or younger than the deck"],
];

/** `screen`: the Markdown export, which reads like the page (3-decimal scores, the Why lines as shown). CSV keeps 6. */
function row(r: CheckResult["comps"][number], all: CheckResult["comps"], screen = false) {
  const m = r.match;
  return {
    comp: `${m.input.title}${m.input.year ? ` (${m.input.year})` : ""}${m.input.director ? `, ${m.input.director}` : ""}`,
    match: m.badge === "Matched" ? `${m.matchedTitle} (${m.matchedYear ?? "?"})` : "",
    badge: m.badge,
    score: r.fit?.status === "Scored" && typeof r.fit.affinity === "number" ? r.fit.affinity.toFixed(screen ? 3 : 6) : r.agentStatus === "set_aside" ? "Set aside" : r.fit?.status ?? "Not run",
    rank: r.rank ? `${r.rank.rank} of ${r.rank.of}` : "",
    gap: r.rank ? (compGap(r, all) ?? (r.rank.gapToNext !== undefined ? r.rank.gapToNext.toFixed(3) : "top")) : "", // the gap as shown (lib/rank-display.ts)
    popularity: typeof r.views?.views === "number" ? String(r.views.views) : "",
    flags: [r.considerCutting && r.cutLabel ? r.cutLabel : "", r.skewFlag ? "audience outlier (Qloo's estimate)" : "", r.skewSplit ? "audience split (Qloo's estimate)" : "", r.considerCutting && r.leastViewed ? "also least viewed" : "", m.warning ? "thin record" : "", r.agentStatus === "set_aside" ? "set aside" : "", r.agentStatus === "dropped" ? "dropped" : ""].filter(Boolean).join("; "),
    reasons: (screen ? r.reasons : r.reasonsExport ?? r.reasons).join(" "),
  };
}

export function toMarkdown(raw: CheckResult): string {
  const res = withShownGaps(raw);
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  // Dated by the recording when the Qloo values were recorded; otherwise by the run.
  // One recorded-date line (Oct 30): a sample's label carries the date, so the head line and the stamp drop theirs.
  const label = sampleLabel(res);
  const lines = ["# Film Comp Check", "", label ? `Exported ${stampDate(res.ranAt)}.` : res.recorded ? `Qloo results recorded ${stampDate(res.recorded.at)}. Exported ${stampDate(res.ranAt)}.` : `Run: ${stampDate(res.ranAt)}`, ""];
  const stamp = recordedStamp(res, { steps: res.comps.filter((c) => c.match.badge === "Matched").length >= MIN_MATCHED_FOR_FIT, date: !label });
  if (sampleLabel(res)) lines.push(`${sampleLabel(res)}.`, "");
  if (stamp) lines.push(`${stamp}.`, "");
  if (res.verdictLines?.length) lines.push("Verdict:", "", ...res.verdictLines.map((l) => `- ${l}`), "");
  lines.push("| Comp | Qloo match | Badge | Fit score | Rank | Gap to next | Flags | Wikipedia views (context) | Reasons |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of res.comps.map((c) => row(c, res.comps, true))) lines.push(`| ${esc(r.comp)} | ${esc(r.match)} | ${r.badge} | ${r.score} | ${r.rank} | ${r.gap} | ${esc(r.flags)} | ${r.popularity} | ${esc(r.reasons)} |`);
  lines.push("", "## Audience (Qloo's estimate)", "", "How far each comp's audience sits from the deck average, to 3 decimals.", "");
  if (res.skewThresholdExport) lines.push(`A comp is flagged as an audience outlier when its age gap or female gap is over ${res.skewThresholdExport}.`, "");
  lines.push("Lean values are Qloo scores, not percentages. Age lean direction is older or younger than this deck.", "");
  const au0 = res.audience;
  if (au0 && au0.unavailable.length) lines.push(`Audience check incomplete: ${au0.unavailable.length} of ${au0.attempted} comps had no estimate (${au0.unavailable.join(", ")}). Their audience fields read unavailable; the deck mean and gaps use the other ${au0.available}.`, "");
  if (res.deckAudienceExport) {
    const m = res.deckMean?.age;
    const au = res.audience, partial = !!au && au.unavailable.length > 0;
    const basis = partial ? ` (based on ${au!.available} of ${au!.attempted} comps)` : "";
    const overall = typeof m === "number" && res.deckAudienceExport.meanAge ? (m < 0 ? ` This deck leans young overall${basis}.` : m > 0 ? ` This deck leans older overall${basis}.` : "") : "";
    lines.push(`Deck average, ${partial ? `the ${au!.available} comps with an estimate` : "all comps"}: female lean ${res.deckAudienceExport.meanFemale}; age lean ${res.deckAudienceExport.meanAge}.${overall}`, "");
  }
  // Plain columns (Oct 30): the "skew distance" and "larger gap" columns repeated the two gaps, so they're left out here.
  const cols = MD_AUDIENCE.filter(([k]) => AUDIENCE_COLUMNS.some(([x]) => x === k));
  lines.push(`| Comp | ${cols.map(([, h]) => h).join(" | ")} | Note |`, `|---|${cols.map(() => "---").join("|")}|---|`);
  for (const c of res.comps) {
    const a = c.audienceExport;
    if (!a) continue;
    lines.push(`| ${esc(c.match.input.title)} | ${cols.map(([k]) => a[k] ?? "").join(" | ")} | ${esc(a.note ?? "")} |`);
  }
  const lc = res.liveSample?.compare;
  if (lc) {
    lines.push("", "## Live run comparison", "", liveCompareLabel(lc), "", liveCompareSummary(lc, 6), "", `| Comp | ${lc.kind === "recording" ? "Live" : "Second live run"} | ${lc.kind === "recording" ? "Recording" : "First live run"} | Difference | 6 decimals |`, "|---|---|---|---|---|");
    for (const x of lc.rows) lines.push(`| ${esc(x.title)} | ${x.now?.toFixed(6) ?? ""} | ${x.before?.toFixed(6) ?? ""} | ${x.diff === undefined ? "" : x.diff.toFixed(6)} | ${x.diff === undefined ? "no score" : x.same6 ? "matched" : "differs"} |`);
  }
  if (res.steps?.length) {
    lines.push("", "## Agent steps", "");
    for (const st of res.steps) lines.push(`${st.n}. ${st.action}: ${esc(st.reason)}${st.outcome ? ` (${esc(st.outcome)})` : ""}${st.rejected ? ` Rejected: ${esc(st.rejected)}` : ""}`);
  }
  lines.push("", FIXED_LINE, "");
  return lines.join("\n");
}

export function toCsv(raw: CheckResult): string {
  const res = withShownGaps(raw);
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const aud = AUDIENCE_COLUMNS.map(([, h]) => q(h + EST));
  const out = ["comp,match,badge,score,rank,gap_to_next,flags,wikipedia_views_context,reasons," + aud.join(",") + "," + q("audience note") + "," + q("deck mean female lean" + EST) + "," + q("deck mean age lean" + EST) + "," + q("deck mean basis")];
  for (const c of res.comps) {
    const r = row(c, res.comps), a = c.audienceExport;
    out.push([r.comp, r.match, r.badge, r.score, r.rank, r.gap, r.flags, r.popularity, r.reasons, ...AUDIENCE_COLUMNS.map(([k]) => (a ? a[k] ?? "" : "")), a?.note ?? "", res.deckAudienceExport?.meanFemale ?? "", res.deckAudienceExport?.meanAge ?? "", res.audience ? (res.audience.unavailable.length ? `${res.audience.available} of ${res.audience.attempted} comps` : `all ${res.audience.attempted} comps`) : ""].map(q).join(","));
  }
  // Footer notes fill the same columns as the header so the CSV stays rectangular: the note goes in "comp", the rest stay empty.
  const width = out[0].split(",").length;
  const note = (s: string) => [q(s), ...Array(width - 1).fill('""')].join(",");
  out.push(note(FIXED_LINE));
  const stamp = recordedStamp(res, { steps: res.comps.filter((c) => c.match.badge === "Matched").length >= MIN_MATCHED_FOR_FIT });
  if (sampleLabel(res)) out.push(note(`${sampleLabel(res)}.`));
  if (stamp) out.push(note(`${stamp}.`));
  const lc = res.liveSample?.compare;
  if (lc) {
    out.push(q(liveCompareLabel(lc)), q(liveCompareSummary(lc, 6)), ["live comparison comp", lc.kind === "recording" ? "live fit" : "second live fit", lc.kind === "recording" ? "recording fit" : "first live fit", "difference", "6 decimals"].map(q).join(","));
    for (const x of lc.rows) out.push([x.title, x.now?.toFixed(6) ?? "", x.before?.toFixed(6) ?? "", x.diff === undefined ? "" : x.diff.toFixed(6), x.diff === undefined ? "no score" : x.same6 ? "matched" : "differs"].map(q).join(","));
  }
  return out.join("\n") + "\n";
}
