import { NextResponse } from "next/server";
import { runCheck, runSampleCheck, type CheckProgress } from "@/lib/check";
import { checkEventStream } from "@/lib/stream";
import { TemplateProvider } from "@/lib/agent";
import { validateComps } from "@/lib/parse";
import { compRecording, fromSample, NOT_RECORDED, replayFor, sampleFor } from "@/lib/samples";
import { kv } from "@/lib/kv";
import { firewallLimited, liveMode, recordLive, takeVisitorCheck, VISITOR_LIMIT } from "@/lib/pacing";
import { compareWithRecording, recordSampleLive, recordedViews, sampleGateFor, takeSampleDay, takeSampleVisitor } from "@/lib/live-sample";
import { SAMPLE_LIVE_OFF, SAMPLE_VISITOR_LIMIT } from "@/lib/messages";
import type { CheckResult, CompInput } from "@/lib/types";
import type { Replay } from "@/lib/trim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // the stream's own deadline is 45 s (lib/stream.ts)

/** Replay the recorded model steps instead of calling the model: AGENT_REPLAY=1, or Claude configured (always on Vercel) without a key. */
const wantReplay = () => process.env.AGENT_REPLAY === "1" || ((process.env.AGENT_PROVIDER === "claude" || !!process.env.VERCEL) && !(process.env.QLOO_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY));
type Run = (on: (e: CheckProgress) => void) => Promise<CheckResult>;
const fail = (msg: string): Run => async () => { throw Object.assign(new Error(msg), { name: "QlooError" }); };

/**
 * Which run serves this deck, cheapest first: a recorded sample (Qloo values recorded, the model runs live;
 * replay only when the model can't run); a custom comp list recorded in the last 30 days; otherwise a live
 * Qloo check, if today's pacing and this visitor's daily limit allow it.
 */
async function pick(req: Request, comps: CompInput[], fresh: boolean): Promise<Run> {
  const db = kv();
  const fx = await sampleFor(comps);
  if (fx) {
    // The replay covers the full recorded deck only (fx.comps is already narrowed to the request, so compare with the replay).
    const rp = wantReplay() ? await replayFor(fx.id) : undefined;
    const serve = (r: Replay): Run => async (on) => {
      for (const st of r.result.steps ?? []) { on({ type: "step", phase: "done", step: st }); await new Promise((res) => setTimeout(res, 40)); }
      return { ...r.result, ranAt: new Date().toISOString(), recorded: { deck: fx.label, at: fx.recordedAt, replay: { model: r.model, at: r.recordedAt } } };
    };
    if (rp && rp.result.comps?.length === comps.length) return serve(rp);
    // After a Remove: the replay recorded for this make-up, if there is one (same order as the request).
    if (rp && comps.length < (rp.result.comps?.length ?? 0)) {
      const key = (c: CompInput) => c.title.trim().toLowerCase();
      const want = new Set(comps.map(key));
      const without = (rp.result.comps ?? []).map((c) => c.match.input).filter((c) => !want.has(key(c))).map((c) => c.title);
      const sub = await replayFor(fx.id, without);
      const order = (r: Replay) => (r.result.comps ?? []).map((c) => key(c.match.input)).join("\n");
      if (sub && order(sub) === comps.map(key).join("\n")) return serve(sub);
    }
    // Judge mode (no model key), no replay for this make-up: a Remove on a recorded sample is re-scored from the recording
    // (every subset of the sample deck is recorded), with Template steps instead of an error. 0 Qloo calls. With no recorded
    // replay at all, a no-key run still ends in the plain agent error.
    if (rp && comps.length < (rp.result.comps?.length ?? 0)) return (on) => runSampleCheck(fx, comps, { onEvent: on, provider: new TemplateProvider() });
    return (on) => runSampleCheck(fx, comps, { onEvent: on });
  }
  const mode = await liveMode(db);
  if (!fresh || mode.mode !== "live") {
    const cr = await compRecording(comps);
    if (cr) return (on) => runSampleCheck(cr, comps, { onEvent: on });
  }
  if (mode.mode !== "live") return fail((await fromSample(comps)) ? NOT_RECORDED : mode.message);
  if (!(await takeVisitorCheck(db, req))) return fail(VISITOR_LIMIT);
  return (on) => runCheck(comps, { bypassCache: fresh, onEvent: on, onLiveDone: (i) => recordLive(db, i.qlooCalls, i.remaining) });
}

/**
 * "Run live on Qloo" on a recorded sample: real Qloo calls with the cache skipped, behind the sample gate
 * (lib/live-sample.ts), one per visitor per day (the second, live-vs-live run is that visitor's second).
 * The agent runs as on any live check (Claude chooses, when configured). The first run is compared with the
 * recording; the page compares the second with the first.
 */
async function pickLiveSample(req: Request, comps: CompInput[], second: boolean): Promise<Run> {
  const db = kv();
  const fx = await sampleFor(comps);
  if (!fx) return fail("Run live on Qloo is for the sample decks.");
  const gate = await sampleGateFor(db, comps.length);
  if (!(second ? gate.second : gate.first)) return fail(SAMPLE_LIVE_OFF);
  if (!(await takeSampleVisitor(db, req, second))) return fail(SAMPLE_VISITOR_LIMIT);
  if (!(await takeSampleDay(db))) return fail(SAMPLE_LIVE_OFF); // through Nov 1: one live sample run a day across all visitors
  return async (on) => {
    const r = await runCheck(comps, { bypassCache: true, record: false, views: recordedViews(fx), onEvent: on, onLiveDone: (i) => recordSampleLive(db, i.qlooCalls, i.remaining) });
    return { ...r, liveSample: { sampleId: fx.id, second, recordedAt: fx.recordedAt, compare: second ? undefined : compareWithRecording(r, fx, comps) } };
  };
}

export async function POST(req: Request) {
  let body: { comps?: CompInput[]; fresh?: boolean; live?: "sample" | "sample-second" };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request body." }, { status: 400 }); }
  const comps = (body.comps ?? []).map((c) => ({
    title: String(c.title ?? "").trim(),
    year: typeof c.year === "number" && Number.isFinite(c.year) ? c.year : undefined,
    director: c.director ? String(c.director).trim() : undefined,
  })).filter((c) => c.title);
  const err = validateComps(comps);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const run = (await firewallLimited(req)) ? fail(VISITOR_LIMIT)
    : body.live === "sample" || body.live === "sample-second" ? await pickLiveSample(req, comps, body.live === "sample-second")
    : await pick(req, comps, body.fresh === true);
  if (new URL(req.url).searchParams.get("stream") === "1") {
    return new Response(checkEventStream(run, comps.length), {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  }
  try { return NextResponse.json(await run(() => {})); }
  catch (e) { return NextResponse.json({ error: e instanceof Error && e.name === "QlooError" ? e.message : "Check failed." }, { status: 502 }); }
}
