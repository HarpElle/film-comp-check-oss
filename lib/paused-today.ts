/**
 * Whether the page shows "Live checks are paused for today": only while live checks are paused for a real
 * visitor, never in judge mode (no Qloo key, or live checks switched off) and never on a sample run.
 */
export function showPausedToday(status: { qlooLive: boolean; judge?: boolean } | null | undefined, sampleRun: boolean): boolean {
  return !!status && !status.qlooLive && !status.judge && !sampleRun;
}
