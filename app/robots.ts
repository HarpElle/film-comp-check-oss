import type { MetadataRoute } from "next";

/** UX audit WP-16 (13.3): allow all; point at the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }], sitemap: "https://filmcompcheck.com/sitemap.xml" };
}
