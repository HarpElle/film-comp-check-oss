import { touchIcon } from "@/lib/og-image";

// /apple-touch-icon.png, 180x180, prerendered at build time (share icon).
export const dynamic = "force-static";
export const runtime = "nodejs";
export const GET = () => touchIcon();
