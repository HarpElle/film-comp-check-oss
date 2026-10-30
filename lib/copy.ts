import { SKEW_THRESHOLD } from "./skew";
/** Landing copy, used verbatim. Do not edit wording here without new copy. */
export const COPY = {
  title: "Film Comp Check",
  purpose: "Check whether each film on your comp slide belongs there.",
  sub: "For producers checking a comp slide before it goes to investors.",
  compsDef: "Comps are past films your pitch deck names as like yours, to show investors there is an audience for it.",
  button: "Try the Pennywell sample",
  /** Who-pays block, locked 2026-10-27, verbatim. */
  whoPays: "Film funds ask for comps. Telefilm Canada wants the performance of comparable films in production financing applications, and the New Zealand Film Commission wants comparative titles with their box office. Filmmakers already pay for comps built on box office, such as $599 for 10 films from FilmProposals or $299 for a FILM.FUND Comparable Film Report. Those tools measure money. Film Comp Check uses Qloo taste data to test whether a deck's comps fit together and draw a similar audience, and flags any comp that doesn't.",
  differs: "Other tools help you find or build comps. This checks the comps you already picked.",
  limits: "It doesn't predict box office, and it doesn't catch a same-genre hit added to make a deck look bigger.",
} as const;

/** The landing's two lines: the who-pays block, then how it differs. */
export const FOLDED: readonly string[] = [COPY.whoPays, `How it differs: ${COPY.differs}`];

/** The printed sheet's head line. Recorded results say "Printed", live runs "Run" (UX audit WP-1). */
export const PRINT_HEAD = {
  lead: "Film Comp Check sheet.",
  run: (at: string) => `Run ${at}.`,
  printed: (at: string) => `Printed ${at}.`,
  fit: "Fit scores come from Qloo data, computed the same way every time.",
} as const;

/** Results table and legend copy (UX audit WP-2). */
export const TABLE = {
  why: "Why \u2193",
  legend: "Fit score: how well this comp fits with the rest of your comps, scored by Qloo the same way every time. Higher fits better.",
  legendScreen: "Open a comp for its Why lines and audience bars. Remove a comp to re-score the rest; Undo puts it back.",
  /** Popularity context in the detail row (Oct 30). */
  views: (n: string) => `Context only: ${n} Wikipedia views, a rough sign of how well known this title is.`,
  /** Before a Remove, beside the new value (UX audit WP-5). */
  was: "was",
} as const;

/** Landing additions (UX audit WP-3). */
export const LANDING = {
  how: [
    "Matches each comp to its Qloo film record.",
    "Scores fit and audience from Qloo data, the same way every time.",
    "Claude picks which extra checks to run and says why. It never sets a score.",
  ],
  sampleNote: "Pennywell: six horror comps. Dream Hackers: five sci-fi comps. Both replay a recorded run; no new Qloo calls.",
  ownComps: "Or check your own comps \u2193",
  dreamButton: "Try the Dream Hackers sample",
  asideLabel: (deck: string, n: number) => `Sample result: ${deck} deck, ${n} comps`,
  provenance: (date: string) => `From a real check on Qloo results recorded ${date}.`,
  pausedToday: "Live checks are paused for today to stay within our Qloo limit. Try again tomorrow.",
  fullResult: "See the full result \u2192",
  whoLabel: "Who needs comps",
  differsLabel: "How it differs",
} as const;

/** The header's deck chip (WP-A; the part-of-a-sample form is UX audit WP-5). */
const sampleName = (label: string) => label.replace(/\s*deck$/i, "");
export const DECKCHIP = {
  full: (label: string, n: number) => `${sampleName(label)} sample \u00b7 ${n} comps`,
  part: (label: string, n: number, m: number) => `${sampleName(label)} sample \u00b7 ${n} of ${m} comps`,
  custom: (n: number) => `${n} comps`,
} as const;

/** Trust and provenance copy (UX audit WP-6). The outlier threshold is read from lib/skew.ts, never typed. */
export const PROVENANCE = {
  loadingSample: (label: string) => `Loading the recorded ${label.replace(/\s*deck$/i, "")} sample. No new Qloo calls.`,
  loadingCustom: (n: number) => `Checking ${n} comps with Qloo. Steps appear below as they finish.`,
  howNumbersSummary: "How these numbers are made",
  howNumbers: [
    "Fit score: Qloo's fit of this comp with the other comps in your deck, shown to 3 decimals.",
    "Audience lean: Qloo's age and gender estimates, from \u22121 to 1.",
    `Audience outlier: the one comp more than ${SKEW_THRESHOLD} from the deck average.`,
    "Consider cutting: the lowest comp's gap to the next is bigger than the spread of the rest.",
    "Claude: picks extra checks (tags, page views) and writes their reasons. Every number in a reason is checked against a tool result before it shows.",
  ],
  copied: "Link copied. Anyone with it sees these comps.",
} as const;

/** Export menu labels and file names (UX audit WP-13). */
export const EXPORT = {
  print: "Print one-page sheet",
  markdown: "Download Markdown (.md)",
  csv: "Download CSV (.csv)",
  link: "Copy share link",
  /** film-comp-check-{sample id or "deck"}-{YYYY-MM-DD}.{ext}, dated in Chicago time. */
  file: (id: string | undefined, ext: "md" | "csv", now = new Date()) =>
    `film-comp-check-${id ?? "deck"}-${now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" })}.${ext}`,
} as const;

/** The comps box (UX audit WP-12). */
export const INPUT = {
  count: (n: number) => `${n} ${n === 1 ? "comp" : "comps"}${n > 10 ? " (10 max)" : n > 0 && n < 3 ? " (3 min)" : ""}`,
  shortcut: " Press \u2318 Enter or Ctrl Enter to check.",
  liveChecks: (n: number) => `Live checks: ${n} per visitor per day.`,
  paused: "Your own comps can be checked once live checks are back.",
} as const;

/** Deck map caption under the plot (UX audit WP-8); the threshold is read from lib/skew.ts. */
export const MAP_COPY = {
  box: `Dashed box: within ${SKEW_THRESHOLD} of the deck average.`,
} as const;

/** Share preview copy (UX audit WP-16, 13.5). */
export const SHARE = {
  ogAlt: "Film Comp Check logo, purpose line, and an Audience outlier tag (Qloo's estimate).",
} as const;

/** What the fit scores mean, beside the table (approved Oct 30). "Close" = every comp within 0.02 of the next. */
export const SCALE = {
  line: "Scores run from 0 to 1. Higher means the comp's audience matches your film's more closely.",
  close: "These comps are all close, so none stands out.",
  closeGap: 0.02,
} as const;

/**
 * What to do about each flag (approved Oct 30), shown under the flag in place of a bare "Check it.". The first two are
 * the approved lines; the others follow their style: the choice (keep, swap, defend) and when to make it.
 */
export const NEXT_STEP = {
  skew: "Keep it if you can explain the gap to investors, or swap in a comp closer to your audience.",
  lowFit: "This is the comp investors will question first. Be ready to defend it, or try cutting it.",
  split: "Keep it if your film draws more than one audience; if not, swap it for a comp closer to your core audience.",
  leastViewed: "Investors may not know this title. Keep it if it's the closest match; otherwise swap in a better-known comp.",
  thin: "Qloo has little data on this title. Keep it if investors know it; otherwise swap in a better-documented comp.",
  unavailable: "Its audience can't be compared. Keep it if its fit is strong, and be ready to defend its audience with your own data.",
} as const;
