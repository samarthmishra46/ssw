import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // One Docker image for AWS Fargate (docs/04).
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: { "/**": ["../../packages/db/drizzle/**"] },
  transpilePackages: ["@ssw/content", "@ssw/core", "@ssw/db", "@ssw/funnel", "@ssw/integrations"],
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
