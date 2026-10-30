/** Plain copy shared by server and page. */
export const VISITOR_LIMIT = "You've used today's live checks. The sample decks still run.";
/** "Run live on Qloo" on a sample: one per visitor per day, separate from the custom-deck limit. */
export const SAMPLE_VISITOR_LIMIT = "You've used today's live run of a sample deck. The recorded samples still run.";
export const SAMPLE_LIVE_OFF = "A live run of the sample isn't available right now. The recorded run still works.";
/** The quiet line where the live-run button doesn't show. */
export const SAMPLE_QUIET = "Run again on your own deck to compare live.";
export const SAMPLE_QUIET_AFTER_LIVE = "Run again on your own deck to compare live.";
export const SOURCE_URL = "https://github.com/HarpElle/film-comp-check-oss";
export const SOURCE_LABEL = "Source code (MIT)";
export const PRIVACY_FOOTER = "Nothing is saved to an account. To save Qloo calls, the comp titles you enter are cached for 30 days. Daily limits count visits by a hashed IP, which is kept for 48 hours.";
/** Qloo failures the run reports as-is (lib/tools.ts), shared with the page's error states. */
export const QUOTA_USED_UP = "This check couldn't run: Qloo's request limit for this app is used up. Nothing was scored.";
export const CANT_REACH = "This check couldn't reach Qloo. Nothing was scored. Try again in a minute.";
