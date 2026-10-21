import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // The preview panel serves the dev server from *.space-z.ai subdomains;
  // without this Next.js warns on every /_next/* asset request (dev only).
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
