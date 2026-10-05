import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@domi-ops/marketing-ui"],
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
