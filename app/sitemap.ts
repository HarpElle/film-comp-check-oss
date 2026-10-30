import type { MetadataRoute } from "next";

/** UX audit WP-16 (13.3): one page. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://filmcompcheck.com/" }];
}
