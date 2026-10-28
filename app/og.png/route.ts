import { ogImage } from "@/lib/og-image";

// /og.png, prerendered at build time (share image).
export const dynamic = "force-static";
export const runtime = "nodejs";
export const GET = () => ogImage();
