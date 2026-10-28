/**
 * Records one Claude run on the recorded Pennywell sample (Qloo values from the fixture, zero Qloo calls;
 * the model is called live once) as a replay for when Claude is unavailable. Holds the derived result the
 * page shows: steps with picks, reasons and cited values, Why lines and tag notes, token stats.
 * Reads the Pennywell sample from the seeded store (scripts/seed-store.ts); writes .data/recorded/ (gitignored),
 * then re-run the seed script to put it in the store.
 * REPLAY_WITHOUT="Title[|Title]" records the make-up after a Remove instead (key sample:replay:<id>:without:<titles>),
 * and REPLAY_PUT=1 also writes the replay into the store at STORE_FILE_DIR (a local file store only; refused otherwise).
 * Run: npx vitest run --config scripts/vitest.scripts.config.ts scripts/build-claude-replay.ts
 */
import { it, expect } from "vitest";
process.env.STORE_FILE_DIR ??= require("node:path").resolve(__dirname, "../.data/store");
import { promises as fs } from "node:fs";
import path from "node:path";
import { runSampleCheck } from "@/lib/check";
import { ClaudeProvider } from "@/lib/providers/claude";
import { PENNYWELL } from "@/lib/demo";
import { sampleFor, type ClaudeReplay } from "@/lib/samples";
import { K, kv } from "@/lib/kv";
import { getStore } from "@/lib/store";

it("records a Claude replay for Pennywell", async () => {
  delete process.env.QLOO_API_KEY; // nothing here may reach Qloo
  const without = (process.env.REPLAY_WITHOUT ?? "").split("|").map((t) => t.trim()).filter(Boolean);
  const comps = PENNYWELL.filter((c) => !without.some((t) => t.toLowerCase() === c.title.toLowerCase()));
  expect(comps.length).toBe(PENNYWELL.length - without.length);
  const fx = (await sampleFor(comps))!;
  expect(fx, "this make-up is not in the recorded sample").toBeTruthy();
  const r = await runSampleCheck(fx, comps, { provider: new ClaudeProvider() });
  expect(r.qlooCalls).toBe(0);
  expect(r.agentStats?.fallbacks).toBe(0);
  const { recorded: _r, ...result } = r;
  const out: ClaudeReplay = {
    schema: "film-comp-check/replay@1", id: fx.id, recordedAt: r.ranAt, model: r.agentStats?.responseModel, without: without.length ? without : undefined,
    result: { ...result, comps: result.comps.map((c) => ({ ...c, match: { ...c.match, entityId: undefined }, fit: c.fit && { ...c.fit, entityId: "" } })) },
  };
  const name = without.length ? `${fx.id}-without-${without.map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-")).join("-")}` : fx.id;
  const file = path.resolve(__dirname, `../.data/recorded/${name}.claude-replay.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(out, null, 1) + "\n");
  if (process.env.REPLAY_PUT === "1") {
    expect(getStore().kind, "REPLAY_PUT writes a local file store only").toBe("file");
    expect(await kv().putReplay(out)).toBe(true);
  }
  console.log("FILE", file, "KEY", without.length ? K.replayWithout(fx.id, without) : K.replay(fx.id));
  console.log("REPLAY", JSON.stringify({ choices: r.agentStats?.choices, tokensIn: r.agentStats?.tokensIn, tokensOut: r.agentStats?.tokensOut, cw: r.agentStats?.cacheCreationTokens, cr: r.agentStats?.cacheReadTokens, calls: r.agentStats?.calls, model: r.agentStats?.responseModel, notes: r.comps.filter((c) => c.tagNote).map((c) => c.match.input.title) }));
}, 90_000);
