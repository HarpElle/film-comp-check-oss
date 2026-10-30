"use client";

import { showPausedToday } from "@/lib/paused-today";
import { useEffect, useRef, useState } from "react";
import { PENNYWELL } from "@/lib/demo";
import { COPY, DECKCHIP, PRINT_HEAD, PROVENANCE, SCALE, TABLE } from "@/lib/copy";
import type { PageStatus } from "@/lib/status";
import { formatCompLines, parseCompLines } from "@/lib/parse";
import { AGENT_DOWN, agentDown, BROKEN_LINK, deckError, OFFLINE_MESSAGE, runError, sharedDeckLine, STOPPED_LINE, type ErrorAction, type ErrorView } from "@/lib/error-state";
import { AgentDownNotice, MatchPanels, RunErrorPanel } from "./components/ErrorPanel";
import { readEvents } from "@/lib/events";
import { type AgentStep, type CheckResult, type CompInput, type CompResult, type MatchOption } from "@/lib/types";
import { Icon } from "./components/Icon";
import { DeckMap, DeckMapSkeleton } from "./components/DeckMap";
import { VerdictLines } from "./components/Verdict";
import { focusLinkTarget, noteId, stepId } from "./components/linkTarget";
import { readShare, shareSearch } from "@/lib/share";
import { removalSummary, restoreAt } from "@/lib/change-summary";
import { MIN_MATCHED_FOR_FIT } from "@/lib/limits";
import { compareRuns, fitDiffs, fitsOf } from "@/lib/compare";
import { compGap, withShownGaps } from "@/lib/rank-display";
import { loadDraft, saveDraft } from "@/lib/draft";
import { recordedStamp, sampleLabel } from "@/lib/stamp";
import { AppHeader } from "./components/AppHeader";
import { DeckInput } from "./components/DeckInput";
import { ExportMenu } from "./components/ExportMenu";
import { Footer } from "./components/Footer";
import { Landing } from "./components/Landing";
import { LiveCompare } from "./components/LiveCompare";
import { ResultsTable } from "./components/ResultsTable";
import { ColdStatusLines, ct, StatusLines } from "./components/StatusLines";
import { LiveSteps, StepsLog } from "./components/Steps";

type LiveKind = "sample" | "sample-second";

/** UX audit WP-10 (8.9): the tab names the deck after a run, and the product on the landing. */
function DocTitle({ title }: { title: string }) {
  useEffect(() => { document.title = title; }, [title]);
  return null;
}

export default function CompCheck({ initialStatus }: { initialStatus: PageStatus | null }) {
  const [text, setText] = useState(""); // UX audit WP-3 (D4): the box starts empty; samples, drafts and share links fill it
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const verdictRef = useRef<HTMLHeadingElement>(null);
  const wasBusy = useRef(false);
  // Remove/Undo (WP-C): what was removed, from where, and the result before it, for the change summary and Undo.
  const [removal, setRemoval] = useState<{ title: string; index: number; input: CompInput; before: CheckResult; undone?: boolean } | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false); // WP-G: the step log opens from "Show steps"
  const removalRef = useRef<typeof removal>(null);
  removalRef.current = removal;
  const focusAfter = useRef<{ kind: "undo" } | { kind: "title"; title: string } | null>(null);
  // Export menu: close on a pointer press outside it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => { const d = menuRef.current; if (d?.open && !d.contains(e.target as Node)) d.open = false; };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  // After a run finishes, move focus to the verdict so keyboard and screen-reader users land on the answer.
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const f = focusAfter.current; focusAfter.current = null;
      // UX audit WP-5 (11.3): on phones the removed row's Undo is next to the rows; the status line's is a screen up.
      const phone = window.matchMedia("(max-width: 720px)").matches;
      const el = f?.kind === "undo" ? (phone && document.querySelector<HTMLElement>("[data-testid=removed-row-undo]")) || document.querySelector<HTMLElement>("[data-testid=undo-remove]")
        : f?.kind === "title" ? document.querySelector<HTMLElement>(`[data-testid=comp-row][data-title="${CSS.escape(f.title)}"] [data-testid=comp-toggle]`) : null;
      // Undo and the restored title are scrolled into view (on a phone the Remove button can be a screen below the summary).
      if (el) el.focus(); else verdictRef.current?.focus({ preventScroll: true });
    }
    wasBusy.current = busy;
  }, [busy]);
  const [live, setLive] = useState<AgentStep[]>([]);
  const [partial, setPartial] = useState<CheckResult | null>(null); // the core result, shown while chosen steps run
  const [stale, setStale] = useState(false); // this run is calling Qloo live, so the previous result is hidden
  const [error, setError] = useState<string | null>(null); // a run that failed
  const [fieldError, setFieldError] = useState<ErrorView | null>(null); // a deck that can't be checked yet
  const [started, setStarted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null); // the user's own comps, kept in this browser only (lib/draft.ts)
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [deckOrder, setDeckOrder] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null); // row ↔ map point (UX audit WP-8) // phones: flagged comps first unless this is on (D7)
  const [pending, setPending] = useState<CompInput[]>([]);
  const [lastRun, setLastRun] = useState<{ comps: CompInput[]; fresh: boolean; live?: LiveKind; keepRemoval?: boolean } | null>(null);
  const [failedRemove, setFailedRemove] = useState<string | null>(null); // the title a failed Remove was re-scoring without
  const [firstLive, setFirstLive] = useState<CheckResult | null>(null); // the first live sample run, for the live-vs-live comparison
  const [repeat, setRepeat] = useState<string | null>(null);
  const [sharedText, setSharedText] = useState<string | null>(null); // the box text a ?c= link filled in (WP-11, 9.3)
  const [stoppedNote, setStoppedNote] = useState(false); // Stop with no result yet (WP-11, 9.4)
  // Before anyone types: are live Qloo checks on, and which recorded samples exist (no Qloo call behind this).
  const [status, setStatus] = useState<PageStatus | null>(initialStatus);
  const statusRef = useRef(status);
  statusRef.current = status;
  const loadStatus = () => fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  // A step or note hash (typed or followed) opens its container and focuses the target (WP-G).
  useEffect(() => {
    const open = () => {
      const h = location.hash.slice(1);
      if (/^step-\d+$/.test(h)) { setStepsOpen(true); focusLinkTarget(h); }
      else if (h.startsWith("note-")) { setOpen((o) => ({ ...o, [h.slice(5)]: true })); focusLinkTarget(h); }
    };
    window.addEventListener("hashchange", open); return () => window.removeEventListener("hashchange", open);
  }, []);
  // The server render passes the status in; fetch it only when that failed (it is fetched again after a live run).
  useEffect(() => { if (!initialStatus) loadStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A share link carries its deck in the URL (lib/share.ts). A recorded sample replays by itself (0 Qloo calls);
  // any other deck is only filled in, so opening a link never spends a live check.
  const shareRead = useRef(false);
  // WP-14 (14.3): a run the visitor starts from the landing gets its own history entry, so Back returns to the landing.
  const pushNext = useRef(false);
  const startedRef = useRef(false);
  startedRef.current = started;
  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(location.search);
      if (!q.has("c") && !q.has("sample")) {
        abortRef.current?.abort();
        setStarted(false); setEditing(false);
        return;
      }
      if (startedRef.current) return;
      // Forward to a result URL: a recorded sample replays (0 Qloo calls); any other deck is only filled in.
      const sh = readShare(location.search);
      if (!sh || sh.error) return;
      setText(formatCompLines(sh.comps));
      if (statusRef.current?.samples.some((sm) => formatCompLines(sm.comps) === formatCompLines(sh.comps))) check(sh.comps);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const removeAfter = useRef<string | null>(null);
  useEffect(() => {
    const t = removeAfter.current;
    if (!t || busy || !result) return;
    removeAfter.current = null;
    const c = result.comps.find((x) => x.match.input.title.toLowerCase() === t.toLowerCase());
    if (c) remove(c.key);
  }, [busy, result]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shareRead.current || !status) return;
    shareRead.current = true;
    // Demo links (docs/DEMO.md): /?sample=<id> runs a recorded sample; &without=<title> then removes that comp
    // through the normal Remove, so the change summary and Undo show. Both replay the recording, 0 Qloo calls.
    const q = new URLSearchParams(location.search);
    const demo = q.get("sample") && status.samples.find((sm) => sm.id === q.get("sample"));
    if (demo) { removeAfter.current = q.get("without"); setText(formatCompLines(demo.comps)); check(demo.comps); return; }
    const sh = readShare(location.search);
    if (!sh) { const d = loadDraft(); if (d) { setDraft(d); setText(d); } return; }
    setText(formatCompLines(sh.comps));
    if (!sh.error && sh.comps.length) setSharedText(formatCompLines(sh.comps));
    if (!sh.error && status.samples.some((sm) => formatCompLines(sm.comps) === formatCompLines(sh.comps))) { check(sh.comps); return; }
    // An empty deck is a broken link (the copy's line); too few or too many comps keep the deck's own message.
    if (sh.error) setFieldError(sh.error === "empty" ? BROKEN_LINK : deckError(formatCompLines(sh.comps)));
    requestAnimationFrame(() => document.getElementById("comps")?.focus());
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [copied, setCopied] = useState<string | null>(null);
  const copyLink = async () => {
    const url = location.href.split("#")[0];
    try { await navigator.clipboard.writeText(url); setCopied(PROVENANCE.copied); } catch { setCopied(url); }
  };

  async function check(comps: CompInput[], fresh = false, live?: LiveKind, keepRemoval = false) {
    const v = deckError(formatCompLines(comps));
    if (v) { setFieldError(v); setEditing(true); return; }
    if (!keepRemoval) setRemoval(null);
    setStoppedNote(false);
    const removal0 = keepRemoval ? removalRef.current : null;
    if (!started && pushNext.current) history.pushState(null, "", `${location.pathname}${shareSearch(comps)}`);
    pushNext.current = false;
    setStarted(true); setEditing(false); setPending(comps); setCopied(null); setLastRun({ comps, fresh, live, keepRemoval }); setFailedRemove(null); setRepeat(null);
    if (live !== "sample-second") setFirstLive(null);
    const prev = fresh ? result : null;
    setBusy(true); setError(null); setFieldError(null); setLive([]); setPartial(null); setStale(false);
    const ac = new AbortController(); abortRef.current = ac;
    let anyEvent = false;
    try {
      const r = await fetch("/api/check?stream=1", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ comps, fresh, live }), signal: ac.signal });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `The server answered ${r.status}.`);
      }
      let got = false;
      for await (const ev of readEvents(r.body)) {
        anyEvent = true;
        if (ev.type === "step") {
          setLive((prev) => [...prev.filter((x) => x.n !== ev.step.n), ev.step].sort((a, b) => a.n - b.n));
          const note = ev.step.note;
          if (note) setPartial((p) => p && { ...p, comps: p.comps.map((c) => (c.key === note.comp && !c.tagNote ? { ...c, tagNote: note.text, reasons: [...c.reasons, note.text] } : c)) });
        } else if (ev.type === "core_result") setPartial(withShownGaps(ev.result));
        else if (ev.type === "qloo_live") setStale(true);
        else if (ev.type === "result" && live) {
          let res = withShownGaps(ev.result);
          if (live === "sample-second" && firstLive && res.liveSample) res = { ...res, liveSample: { ...res.liveSample, compare: { kind: "live", againstAt: firstLive.ranAt, rows: fitDiffs(res, fitsOf(firstLive)) } } };
          if (live === "sample") setFirstLive(res);
          setResult(res); got = true;
        }
        else if (ev.type === "result") { setResult(withShownGaps(ev.result)); got = true; if (prev) setRepeat(ev.result.recorded ? compareRuns(prev, ev.result).line.replace(/^Run again:/, "Replay of the recorded run:") : compareRuns(prev, ev.result).line); }
        else if (ev.type === "error") throw new Error(ev.error);
      }
      if (!got) throw new Error("The check ended before a result arrived.");
      history.replaceState(null, "", `${location.pathname}${shareSearch(comps)}`);
    } catch (e) {
      if (ac.signal.aborted) { stopped(keepRemoval ? removal0 : null); return; }
      // Offline (WP-11, 9.1): the browser says so, or the request failed before any event arrived.
      const offline = (typeof navigator !== "undefined" && !navigator.onLine) || (e instanceof TypeError && !anyEvent);
      setError(offline ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "The check stopped.");
      // A failed Remove leaves the previous results and their deck in place (copy item 9).
      if (keepRemoval && removal0 && !removal0.undone) { setFailedRemove(removal0.title); setText(formatCompLines(removal0.before.comps.map((c) => c.match.input))); }
    } finally { if (abortRef.current === ac) abortRef.current = null; setBusy(false); setLive([]); setPartial(null); setStale(false); if (live) loadStatus(); }
  }

  const abortRef = useRef<AbortController | null>(null);
  const stop = () => abortRef.current?.abort();
  /** After Stop: the last result stays as it was. A stopped Remove puts the comp back; a stopped Undo stays removed. No result yet: back to the box. */
  function stopped(rm: typeof removal) {
    if (rm && !rm.undone) { setRemoval(null); removalRef.current = null; setText(formatCompLines(rm.before.comps.map((c) => c.match.input))); }
    else if (rm) { const back = { ...rm, undone: false }; setRemoval(back); removalRef.current = back; if (result) setText(formatCompLines(result.comps.map((c) => c.match.input))); }
    if (!result) { setStarted(false); setStoppedNote(true); requestAnimationFrame(() => document.getElementById("comps")?.focus()); }
  }

  function remove(key: string) {
    if (!result) return;
    const index = result.comps.findIndex((c) => c.key === key);
    if (index < 0) return;
    const input = result.comps[index].match.input;
    const keep = result.comps.filter((c) => c.key !== key).map((c) => c.match.input);
    const rm = { title: input.title, index, input, before: result };
    setRemoval(rm); removalRef.current = rm; // check() below reads it before the next render
    focusAfter.current = { kind: "undo" };
    setText(formatCompLines(keep));
    check(keep, false, undefined, true);
  }

  function undoRemove() {
    if (!removal || !result) return;
    const all = restoreAt(result.comps.map((c) => c.match.input), removal.input, removal.index);
    setRemoval({ ...removal, undone: true }); removalRef.current = { ...removal, undone: true };
    focusAfter.current = { kind: "title", title: removal.title };
    setText(formatCompLines(all));
    check(all, false, undefined, true);
  }

  const chosenYet = live.some((st) => st.origin === "model" || st.origin === "template" || st.origin === "stub");
  // One live line at the top while a run is going: the latest step, so the verdict area, the rows and progress all fit at 1280x800.
  const latest = live.at(-1);
  const liveStatus = !busy ? null : partial && partial.provider !== "stub" && !chosenYet ? "Agent is choosing next steps"
    : latest ? `Step ${latest.n}: ${latest.choice?.label ?? latest.action.replace(/_/g, " ")}${latest.outcome ? `, ${latest.outcome}` : latest.reason ? `, ${latest.reason}` : ""}${!latest.outcome ? " (working)" : ""}` : "Starting the check";
  const liveLine = liveStatus && (
    <div className="live-row">
      <p className="muted live-status" data-testid="live-status" role="status"><Icon name="loader" />{liveStatus}</p>
      {/* WP-F: Stop aborts the run (AbortController) and keeps the last result. */}
      <button className="btn link stop no-print" data-testid="stop" onClick={stop}><Icon name="x" />Stop</button>
    </div>
  );
  // While a run is busy: only this run's core result, once it lands.
  // A new run clears the old result right away (QA saw the previous run's "Live: 7 Qloo calls" under a new run's progress).
  // A Remove or Undo keeps the last result on screen while it reruns (WP-C: never blank), muted as "updating".
  const updating = busy && !partial && !!removal && !!result;
  // Any failed run keeps the last result on screen, labeled "Last result: {n} comps" (WP-F).
  const errOn = !!error && !busy;
  const hideResults = errOn && !result;
  const view = busy ? partial ?? (removal ? result : null) : hideResults ? null : result;
  const coldRun = busy && !view && !hideResults;
  const removedPending = busy && removal && !removal.undone ? removal : null;
  const removalLine = !removal ? null : busy ? (removal.undone ? `Putting ${removal.title} back.` : `Rechecking without ${removal.title}.`)
    : !removal.undone && result && !error ? removalSummary(removal.title, removal.before, result) : null;
  const stepList = busy && partial ? live : view?.steps ?? [];
  const noteStep = (key: string) => stepList.find((st) => st.note?.comp === key)?.n;
  const titleOfKey = (key?: string) => (key ? view?.comps.find((c) => c.key === key)?.match.input.title : undefined);
  // WP-G two-way links: open the step log or the comp's detail row, then focus and mark the target.
  const goStep = (n: number) => { setStepsOpen(true); focusLinkTarget(stepId(n)); };
  const goNote = (key: string) => { setOpen((o) => ({ ...o, [key]: true })); focusLinkTarget(noteId(key)); };

  const sampleIdOf = (comps: CompInput[]) => status?.samples.find((sm) => formatCompLines(sm.comps) === formatCompLines(comps))?.id;
  const isSample = (t: string) => !!status?.samples.some((sm) => formatCompLines(sm.comps) === formatCompLines(parseCompLines(t)));
  const ownDeckBlocked = !!status && !status.qlooLive && !isSample(text);
  /** Every comp comes from one recorded sample deck (the full sample, or what's left after a Remove). */
  const sampleRun = (comps: CompInput[]) => !!status?.samples.some((sm) => comps.every((c) => sm.comps.some((x) => formatCompLines([x]) === formatCompLines([c]))));
  const pausedToday = (comps?: CompInput[]) => showPausedToday(status, !!comps && sampleRun(comps));
  const onErrorAction = (a: ErrorAction) => {
    if (a === "retry" && lastRun) check(lastRun.comps, lastRun.fresh, lastRun.live, !!failedRemove && !!lastRun.keepRemoval);
    else if (a === "sample") { setText(formatCompLines(PENNYWELL)); check(PENNYWELL); }
    else setEditing(true);
  };
  const editText = (v: string) => {
    setText(v); setStoppedNote(false);
    if (saveDraft(v, isSample)) setDraft(v);
    else if (!v.trim()) setDraft(null);
  };
  const deckInput = (
    <DeckInput text={text} onText={editText} paused={status && !status.qlooLive ? status.paused ?? "" : undefined} busy={busy} blocked={ownDeckBlocked}
      draft={draft} onRestore={() => { setText(draft!); setFieldError(null); }} onClose={started ? () => setEditing(false) : undefined}
      onCheck={() => { pushNext.current = !started; check(parseCompLines(text)); }} fieldError={fieldError}
      note={sharedText !== null && text === sharedText ? sharedDeckLine(parseCompLines(text).length) : undefined} stoppedNote={stoppedNote ? STOPPED_LINE : undefined} liveChecks={status?.qlooLive ? status.liveChecksPerDay : undefined}
      onFieldAction={(a) => {
        if (a === "new-check" || fieldError?.kind === "broken-link") history.replaceState(null, "", location.pathname); // drop the broken link
        setFieldError(null); document.getElementById("comps")?.focus();
      }} />
  );

  if (!started) {
    return (
      <div className="page">
        <DocTitle title={COPY.title} />
        <AppHeader />
        <main>
          <Landing status={status} busy={busy} pausedToday={pausedToday()} onSample={(comps) => { setText(formatCompLines(comps)); pushNext.current = true; check(comps); }} />
          {deckInput}
        </main>
        <Footer limits={false} />
      </div>
    );
  }


  const shown = view ?? null;
  const matchedN = shown ? shown.comps.filter((c) => c.match.badge === "Matched").length : 0;
  const tooFew = !!shown && matchedN < MIN_MATCHED_FOR_FIT;
  // Too few matched: no rank to show; the Flags column stays only for match-level flags (thin record, estimate unavailable).
  const showFlags = !!shown && (!tooFew || shown.comps.some((c) => c.match.warning || c.skewUnavailable));
  const countLine = shown ? `${matchedN} of ${shown.comps.length} comps matched.` : "";
  // Error copy items 3 and 4: a panel for each comp Qloo couldn't match or that matches records from several years.
  const pickOption = (i: number, o: MatchOption) => {
    const comps = shown!.comps.map((c) => c.match.input).map((c, j) => (j === i ? { ...c, title: o.title, year: o.year } : c));
    setText(formatCompLines(comps)); setEditing(true);
    requestAnimationFrame(() => document.getElementById("comps")?.focus());
  };
  const notFound = shown && <MatchPanels comps={shown.comps} onEdit={() => { setEditing(true); requestAnimationFrame(() => document.getElementById("comps")?.focus()); }} onPick={pickOption} />;
  const chipSample = status?.samples.find((sm) => formatCompLines(sm.comps) === formatCompLines(shown ? shown.comps.map((c) => c.match.input) : pending));
  const chipN = shown?.comps.length ?? pending.length;
  // WP-A deck chip: "Pennywell sample · 6 comps", or "{n} comps"; after a Remove, "Pennywell sample · 5 of 6 comps" (WP-5).
  // UX audit WP-6 (1.7): a recorded sample loads, it doesn't check with Qloo.
  const loadingSample = status?.samples.find((sm) => sm.id === sampleIdOf(pending));
  const chipComps = shown ? shown.comps.map((c) => c.match.input) : pending;
  const partOf = !chipSample && chipComps.length > 0 && sampleRun(chipComps) ? status?.samples.find((sm) => chipComps.every((c) => sm.comps.some((x) => formatCompLines([x]) === formatCompLines([c])))) : undefined;
  const deckChip = chipSample ? DECKCHIP.full(chipSample.label, chipN) : partOf ? DECKCHIP.part(partOf.label, chipN, partOf.comps.length) : DECKCHIP.custom(chipN);
  // WP-K / D7: on phones, flagged comps first unless the visitor picks deck order.
  const isFlagged = (c: CompResult) => !tooFew && (!!c.skewFlag || !!c.skewSplit || !!c.considerCutting);
  const colCount = 8 - (tooFew ? 1 : 0) - (showFlags ? 0 : 1);
  const phoneOrder = shown ? [...shown.comps.filter(isFlagged), ...shown.comps.filter((c) => !isFlagged(c))].map((c) => c.key) : [];

  return (
    <div className="page">
      <DocTitle title={result && !busy ? `${deckChip} \u00b7 ${COPY.title}` : COPY.title} />
      <AppHeader results={{ chip: deckChip, editing, onEdit: () => setEditing((e) => !e) }}>
        {!hideResults && <ExportMenu result={result} busy={busy} menuRef={menuRef} onCopyLink={copyLink} copied={copied} sampleId={result ? sampleIdOf(result.comps.map((c) => c.match.input)) : undefined} />}
      </AppHeader>
      <main>
        {editing && deckInput}
        <div className="print-only small" data-testid="print-head">{PRINT_HEAD.lead} {shown ? `${shown.recorded ? PRINT_HEAD.printed(ct(shown.ranAt)) : PRINT_HEAD.run(ct(shown.ranAt))} ${sampleLabel(shown) ? `${sampleLabel(shown)}. ` : ""}${recordedStamp(shown, { steps: !tooFew && !busy, date: !(removal && !removal.undone) }) ? `${recordedStamp(shown, { steps: !tooFew && !busy, date: !(removal && !removal.undone) })}. ` : ""}${PRINT_HEAD.fit}` : ""}</div>
        <section className={`top${shown && tooFew ? " single" : ""}`} data-testid="top">
          <div className="top-left">
          <div className="top-lead">
            {errOn ? (
              <RunErrorPanel view={runError(error!, failedRemove ?? undefined)} detail={error!} on={onErrorAction} pageHeading={hideResults}
                extra={!failedRemove && status?.samples.some((sm) => sm.id === "dreamhackers") && <button className="btn" disabled={busy} data-testid="error-sample-dreamhackers" onClick={() => { const d = status.samples.find((sm) => sm.id === "dreamhackers")!.comps; setText(formatCompLines(d)); check(d); }}>Dream Hackers sample</button>} />
            ) : null}
            {errOn && shown && <p className="last-result small muted" data-testid="last-result">Last result: {shown.comps.length} comps</p>}
            {!busy && !errOn && agentDown(shown) && <AgentDownNotice view={AGENT_DOWN} disabled={busy} onAgain={() => check(shown!.comps.map((c) => c.match.input), true)} />}
            {shown && !errOn && sampleLabel(shown) && <p className="sample-label small muted" data-testid="sample-label">{sampleLabel(shown)}.</p>}
            {hideResults ? null : shown && tooFew ? (
              <div className="verdict" data-testid="verdict-too-few">
                <h1 className="sr-only" ref={verdictRef} tabIndex={-1} data-testid="verdict-heading">Verdict</h1>
                <ol className="verdict-lines"><li data-testid="verdict-line" data-kind="matched" className="verdict-line"><span className="v-icon v-muted"><Icon name="alert" size={18} /></span><span className="v-text">{countLine}</span></li></ol>
                <p className="too-few" data-testid="too-few">Only {matchedN} {matchedN === 1 ? "comp" : "comps"} matched. Fit scores need at least {MIN_MATCHED_FOR_FIT}, so there&apos;s no verdict yet. Fix or add comps and run again.</p>
                {notFound}
              </div>
            ) : shown?.verdictLines ? (
              <div className="verdict" data-testid="verdict">
                <h1 className="sr-only" ref={verdictRef} tabIndex={-1} data-testid="verdict-heading">Verdict</h1>
                <VerdictLines lines={shown.verdictLines} r={shown} countLine={countLine} />
                {notFound}
              </div>
            ) : (
              <div className="verdict" data-testid="loading-state" aria-busy="true">
                <h1 className="sr-only">Verdict</h1>
                <p className="loading-line"><Icon name="loader" />{loadingSample ? PROVENANCE.loadingSample(loadingSample.label) : PROVENANCE.loadingCustom(pending.length)}</p>
                <div className="skel" style={{ width: "40%" }} /><div className="skel" style={{ width: "85%" }} /><div className="skel" style={{ width: "70%" }} />
              </div>
            )}
          </div>
            {shown && (() => {
              const sid = sampleIdOf(shown.comps.map((c) => c.match.input));
              return <StatusLines shown={shown} hasResult={!!result} busy={busy} tooFew={tooFew} removedNow={!!removal && !removal.undone}
                removal={removal} removalLine={removalLine} canUndo={!busy && !!removal && !removal.undone && !!result} onUndo={undoRemove} liveLine={liveLine}
                sampleId={status?.sampleLiveOn ? sid : undefined} liveGateOpen={!!sid && !!status?.sampleLiveOn && !!status?.sampleLive?.[sid]?.first}
                onRunAgain={() => check(parseCompLines(text), true)} onRunLive={() => check(shown.comps.map((c) => c.match.input), false, "sample")}
                pausedLive={!!shown.recorded && pausedToday(shown.comps.map((c) => c.match.input))} repeat={repeat}
                onSteps={() => { const first = shown.steps?.find((st) => st.origin && st.origin !== "core"); if (first) goStep(first.n); }} />;
            })()}
            {coldRun && <ColdStatusLines liveLine={liveLine} />}
          </div>
          {shown && tooFew ? null : shown ? <DeckMap r={shown} updating={updating} hoverKey={hoverKey} onHover={setHoverKey} /> : hideResults ? null : (
            <DeckMapSkeleton note="The map appears when the audience estimates are in." />
          )}
        </section>
        {/* WP-11 (9.2): a first run of the visitor's own deck failed: the box stays right under the error (no focus move). */}
        {hideResults && !editing && !!lastRun && !lastRun.live && !sampleRun(lastRun.comps) && deckInput}

        {shown && !tooFew && phoneOrder.length > 0 && shown.comps.some(isFlagged) && (
          <p className="phone-order phone-only" data-testid="phone-order">
            <span>{deckOrder ? "Deck order" : "Flagged comps first"}</span>{" "}
            <button className="btn link" aria-pressed={deckOrder} data-testid="deck-order-toggle" onClick={() => setDeckOrder((d) => !d)}>{deckOrder ? "Flagged first" : "Deck order"}</button>
          </p>
        )}
        {!hideResults && <ResultsTable shown={shown} pending={pending} tooFew={tooFew} showFlags={showFlags} colCount={colCount} deckOrder={deckOrder} updating={updating} busy={busy}
          open={open} onToggle={(key) => setOpen((o) => ({ ...o, [key]: !o[key] }))} onRemove={remove} removedPending={removedPending} phoneOrder={phoneOrder}
          isFlagged={isFlagged} noteStep={noteStep} stepOrigin={(n) => stepList.find((st) => st.n === n)?.origin} onStep={goStep}
          hoverKey={hoverKey} onHover={setHoverKey}
          removed={removal && !removal.undone && !error && result ? { before: removal.before, title: removal.title, index: removal.index, onUndo: undoRemove } : null} />}
        {shown?.liveSample?.compare && !busy && <LiveCompare shown={shown} secondOpen={!!status?.sampleLive?.[shown.liveSample.sampleId]?.second} onSecond={() => check(shown.comps.map((c) => c.match.input), false, "sample-second")} />}
        {shown && !tooFew && (() => {
          // Display only: the gaps as shown in the rows (lib/rank-display.ts); nothing is re-scored.
          const gaps = shown.comps.map((c) => compGap(c, shown.comps)).filter((g): g is string => g !== undefined);
          const close = gaps.length > 0 && gaps.every((g) => Number(g) <= SCALE.closeGap);
          return <p className="score-scale" data-testid="score-scale">{SCALE.line}{close && <> <span data-testid="score-scale-close">{SCALE.close}</span></>}</p>;
        })()}
        {shown && !tooFew && <p className="small muted legend-note" data-testid="legend">{TABLE.legend} <span className="no-print">{TABLE.legendScreen}</span></p>}
        {shown && !tooFew && (
          <details className="how-numbers" data-testid="how-numbers">
            <summary><Icon name="chevronRight" />{PROVENANCE.howNumbersSummary}</summary>
            <ul>{PROVENANCE.howNumbers.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </details>
        )}

        {busy && <LiveSteps live={live} choosing={!!partial && partial.provider !== "stub" && !chosenYet} />}
        {!busy && result?.steps && !hideResults && <StepsLog result={{ ...result, steps: result.steps }} tooFew={tooFew} open={stepsOpen} onToggle={() => setStepsOpen((o) => !o)} titleOfKey={titleOfKey} onNote={goNote} />}
      </main>
      <Footer limits={!shown && !coldRun} />
    </div>
  );
}
