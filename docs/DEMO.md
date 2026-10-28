# Demo click path

Works on a keyless judge-mode server (README, "Judge mode"): every step below replays the recording, 0 Qloo calls.

## Seeded state (one link)

`/?sample=pennywell&without=Midsommar` replays the recorded Pennywell sample, then removes Midsommar through the
normal Remove. It lands on: "Rechecked without Midsommar. Ma changed from Lowest fit, close call to Consider
cutting.", Ma's row flagged Consider cutting, an Undo button, and "No new Qloo calls." with the recorded stamp.
`e2e/demo.spec.ts` checks this state against the recording on every run, at 1280 and 375.

`/?sample=pennywell` alone runs the sample with nothing removed.

## Click path (about 90 seconds)

1. Open `/`. Read the purpose line and the recorded sample verdict on the right.
2. Click **Try the Pennywell sample**. Results mode: three verdict lines, the status lines, the deck map and six rows.
   The stamp says the Qloo data is recorded and the agent steps replayed.
3. Click **Show steps**. Click a note marker on a comp ("... step N ↓"); the log opens and that step is focused.
   Click the step's "{Title} note ↑" to go back to the note.
4. Click **Remove** on Midsommar. The row collapses to "Midsommar Removed" while the rest re-scores; then the change
   summary names what changed (Ma becomes Consider cutting). Focus is on **Undo, put Midsommar back**.
5. Click **Undo**. The six rows come back in their order, with the same scores.
6. Open **Export**: Export sheet, Markdown, CSV, **Copy share link**. The link carries the deck in the URL and never expires.
7. Click **Edit comps**, type your own comps: "Draft saved in this browser." A sample run won't overwrite it;
   **Back to my comps** brings it back.
8. Optional: **Try the Dream Hackers sample** (five comps).

## What it can't show without keys

- Your own deck: live checks are paused in judge mode; the button says so.
- A live clock time (the 7:11 PM CT capture): replays show the recorded stamp, not a live run time.
