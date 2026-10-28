import { CANT_REACH, QUOTA_USED_UP, SAMPLE_LIVE_OFF, SAMPLE_VISITOR_LIMIT, VISITOR_LIMIT } from "./messages";
import { parseCompLines } from "./parse";
import type { CheckResult } from "./types";

/**
 * Error and save-state copy (error-empty-states copy, Oct 27 2026), picked by code from what actually failed.
 * Each view is a headline, a body and the buttons the page draws. Any run error also shows WP-F's exact
 * "Check failed." line above it.
 */
export const CHECK_FAILED = "Check failed.";
export const MIN_COMPS = 3;
export const MAX_COMPS = 10;
/** The daily live-check limit resets at midnight Chicago time. */
export const LIMIT_RESET = "midnight";

export type ErrorAction = "retry" | "sample" | "edit" | "add" | "agent-again" | "new-check";
export type ErrorKind = "qloo" | "claude" | "too-many" | "too-few" | "unreadable" | "limit" | "remove" | "other" | "broken-link" | "unmatched" | "several";
export interface ErrorView { kind: ErrorKind; headline: string; body: string; actions: ErrorAction[] }

const QLOO: ErrorView = {
  kind: "qloo", headline: "Qloo isn't answering right now",
  body: "We couldn't get audience data for your comps, so there's no verdict yet. Your list is still here. Try again in a minute, or open a sample deck to see how the check works.",
  actions: ["retry", "sample"],
};
export const AGENT_DOWN: ErrorView = {
  kind: "claude", headline: "The agent didn't run, but your scores did",
  body: "Every score is computed from Qloo data, so the verdict is complete. Claude picks which extra checks to run, and it didn't respond this time, so the Agent steps show the default steps, tagged Template.",
  actions: ["agent-again"],
};
const LIMIT_BODY = "The sample decks still work and make no new Qloo calls.";
const limit = (reset: boolean): ErrorView => ({
  kind: "limit", headline: "Today's live checks are used up",
  body: reset ? `${LIMIT_BODY} Live checks reset at ${LIMIT_RESET} Central time.` : LIMIT_BODY, actions: ["sample"],
});
// The copy's item 10 names a contact address; the app shows none, by design.
const OTHER: ErrorView = { kind: "other", headline: "Something went wrong on our side", body: "Your list wasn't lost. Try again. If it keeps happening, try again later.", actions: ["retry", "sample"] };

/** A share link whose deck can't be read or checked (share links never expire, so this is a damaged or hand-edited URL). */
export const BROKEN_LINK: ErrorView = { kind: "broken-link", headline: "This link is broken or out of date.", body: "Run the check again to get a fresh one.", actions: ["new-check"] };

/** Error copy item 3: a comp Qloo has no record for. */
export const unmatched = (input: string): ErrorView => ({
  kind: "unmatched", headline: `We couldn't match "${input}"`,
  body: "Try the title with its year, like Ma (2019). If it's a short or a festival film, Qloo may not have it yet.", actions: ["edit"],
});
/** Error copy item 4: a comp whose title fits records from different years; the panel lists them to pick from. */
export const several = (input: string): ErrorView => ({ kind: "several", headline: `"${input}" matches more than one title`, body: "Pick the one you meant.", actions: [] });

/** A deck that can't be checked yet, from the box's text; null when it can run. */
export function deckError(text: string): ErrorView | null {
  const comps = parseCompLines(text);
  const n = comps.length;
  // The copy's "or separate titles with commas" is left out: titles can contain commas, so lines are the only separator.
  if (n === 0) return { kind: "unreadable", headline: "We couldn't read that list", body: "Put one title per line. Adding the year helps.", actions: ["retry"] };
  if (n < MIN_COMPS) return { kind: "too-few", headline: `Add at least ${MIN_COMPS} comps`, body: "The check compares each comp against the rest, so it needs a few to compare.", actions: ["add"] };
  if (n > MAX_COMPS) return { kind: "too-many", headline: `Up to ${MAX_COMPS} comps per check`, body: `You entered ${n}. Remove ${n - MAX_COMPS} and run it again. Five to eight comps usually gives the clearest read.`, actions: ["edit"] };
  if (comps.some((c) => c.title.length > 200)) return { kind: "unreadable", headline: "We couldn't read that list", body: "A title is over 200 characters. Shorten it and try again.", actions: ["retry"] };
  return null;
}

/** A run that ended without a result. `removing` is the title being re-scored away when the run was a Remove. */
export function runError(message: string, removing?: string): ErrorView {
  if (removing) return { kind: "remove", headline: `Couldn't re-score without ${removing}`, body: "Your previous results are unchanged.", actions: ["retry"] };
  if (message === VISITOR_LIMIT || message === SAMPLE_VISITOR_LIMIT) return limit(true);
  if (message === QUOTA_USED_UP || message === SAMPLE_LIVE_OFF) return limit(false);
  if (message === CANT_REACH || /\bQloo (did not|didn't) answer\b/.test(message)) return QLOO;
  return OTHER;
}

/** Qloo data came back but Claude didn't answer: every agent choice fell back to the template. */
export function agentDown(r: CheckResult | null | undefined): boolean {
  if (!r || r.provider !== "claude" || r.recorded) return false;
  const s = r.agentStats;
  return !!s && s.apiErrors > 0 && !(r.steps ?? []).some((st) => st.origin === "model");
}
