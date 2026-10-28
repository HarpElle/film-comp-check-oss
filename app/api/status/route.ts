import { NextResponse } from "next/server";
import { pageStatus } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the page needs before anyone types (lib/status.ts). The page's server render reads the same thing. */
export async function GET() {
  return NextResponse.json(await pageStatus());
}
