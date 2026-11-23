import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@domi-ops/marketing-ui"],
  // Standalone traces only files webpack can see. Blog markdown is read at
  // request time from content/blog, so include it in the traced output as well
  // as copying it in apps/www/Dockerfile.
  outputFileTracingIncludes: {
    "/blog": ["./content/blog/**/*"],
    "/blog/[slug]": ["./content/blog/**/*"],
    "/sitemap.xml": ["./content/blog/**/*"],
  },
  async headers() {
    return [
      {
        // Share-card art: stable path, cached a day with a week of stale-while-revalidate.
        source: "/og/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.domi-ops.com",
    NEXT_PUBLIC_DEMO_URL: process.env.NEXT_PUBLIC_DEMO_URL ?? "https://demo.domi-ops.com",
  },
};

export default nextConfig;
