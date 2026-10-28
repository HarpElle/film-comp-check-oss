import CompCheck from "./CompCheck";
import { pageStatus, type PageStatus } from "@/lib/status";

export const runtime = "nodejs";
// Rendered per request so the landing's sample result and sample buttons are in the first HTML (no layout shift
// when /api/status answers). If the store can't be read, the page renders without them and fetches as before.
export const dynamic = "force-dynamic";

export default async function Page() {
  const status: PageStatus | null = await pageStatus().catch(() => null);
  return <CompCheck initialStatus={status} />;
}
