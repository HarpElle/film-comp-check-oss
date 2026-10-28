import { runSampleCheck } from "@/lib/check";
import { StubProvider } from "@/lib/agent";
import type { Kv } from "@/lib/kv";
import type { Recording } from "@/lib/trim";

/**
 * Writes recorded samples (and an optional model replay) into the store, trimmed, under sample: keys with no
 * expiry, plus the landing snippet: the verdict lines of the landing sample run on its recording (stub
 * provider; verdict lines come from the core only). Zero Qloo calls.
 */
export async function seed(db: Kv, recordings: Recording[], opts: { replay?: unknown; landingId?: string } = {}): Promise<string[]> {
  const log: string[] = [];
  for (const r of recordings) log.push(`sample ${r.id}: ${(await db.putSample(r)) ? "written" : "REFUSED (too big or store error)"}`);
  if (opts.replay) log.push(`replay: ${(await db.putReplay(opts.replay)) ? "written" : "REFUSED"}`);
  const land = recordings.find((r) => r.id === (opts.landingId ?? "pennywell"));
  if (land) {
    const res = await runSampleCheck(land, land.comps.map((c) => c.input), { provider: new StubProvider() });
    if (res.qlooCalls) throw new Error("landing run called Qloo");
    log.push(`landing: ${(await db.putLanding({ deck: land.label, comps: res.comps.length, verdictLines: res.verdictLines ?? [], recordedAt: land.recordedAt })) ? "written" : "REFUSED"}`);
  }
  return log;
}
