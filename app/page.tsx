import type { Metadata } from "next";
import CompCheck from "./CompCheck";
import { pageStatus, type PageStatus } from "@/lib/status";
import { kv } from "@/lib/kv";
import { shareMeta } from "@/lib/share-meta";
import { COPY, SHARE } from "@/lib/copy";

export const runtime = "nodejs";
// Rendered per request so the landing's sample result and sample buttons are in the first HTML (no layout shift
// when /api/status answers). If the store can't be read, the page renders without them and fetches as before.
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** UX audit WP-16: a shared link's preview names its deck. canonical, og:image and the card type stay as in the layout. */
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const samples = await kv().sampleIndex().catch(() => []);
  const m = shareMeta(await searchParams, samples);
  if (!m) return {};
  const images = [{ url: "/og.png", width: 1200, height: 630, alt: SHARE.ogAlt }];
  return {
    title: m.title,
    description: m.description,
    openGraph: { type: "website", url: "https://filmcompcheck.com/", title: m.title, description: m.description, images },
    twitter: { card: "summary_large_image", title: m.title, description: m.description, images: ["/og.png"] },
  };
}

export default async function Page() {
  const status: PageStatus | null = await pageStatus().catch(() => null);
  return (
    <>
      {/* UX audit WP-16 (13.4): what the page is, for search engines. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "WebApplication", name: COPY.title, url: "https://filmcompcheck.com/", description: COPY.purpose, applicationCategory: "BusinessApplication", offers: { "@type": "Offer", price: 0, priceCurrency: "USD" } }) }} />
      <CompCheck initialStatus={status} />
    </>
  );
}
