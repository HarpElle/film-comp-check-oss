// Handoff set-up step: tokens first, then base, then the app's own rules. Fonts are self-hosted from
// public/fonts via the @font-face rules in tokens.css (no Google Fonts, no CDN).
import "./styles/tokens.css";
import "./styles/base.css";
import "./globals.css";
import "./styles/layout.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { COPY, SHARE } from "@/lib/copy";

// Share head tags. /og.png and /apple-touch-icon.png are prerendered at build time by lib/og-image.tsx.
export const metadata: Metadata = {
  metadataBase: new URL("https://filmcompcheck.com"),
  title: "Film Comp Check",
  description: COPY.purpose,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "https://filmcompcheck.com/",
    title: "Film Comp Check",
    description: COPY.purpose,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: SHARE.ogAlt }],
  },
  twitter: { card: "summary_large_image", title: "Film Comp Check", description: COPY.purpose, images: ["/og.png"] },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }] },
};
export const viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* UX audit WP-15: the two faces above the fold load first. */}
        <link rel="preload" href="/fonts/Inter-Variable.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/IBMPlexSansCondensed-SemiBold.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
