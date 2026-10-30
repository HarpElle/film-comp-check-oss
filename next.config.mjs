/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // UX audit WP-15: font files never change under the same name.
  async headers() {
    return [{ source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};
export default nextConfig;
