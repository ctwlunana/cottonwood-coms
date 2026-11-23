import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // Client JS file names without route-folder names: app route groups like "(auth)" would otherwise
  // put parentheses in asset URLs, which some proxies re-encode → redirect loops on Cloudflare assets.
  webpack(config, { isServer, dev }) {
    if (!isServer && !dev) {
      config.output.filename = "static/chunks/[contenthash].js";
      config.output.chunkFilename = "static/chunks/[contenthash].js";
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=()" },
        ],
      },
    ];
  },
};
export default nextConfig;

