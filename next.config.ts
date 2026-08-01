import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const chronChaosAuthOrigin = process.env.CHRONCHAOS_AUTH_ORIGIN?.replace(/\/$/, "");

const config: NextConfig = {
  basePath,
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  transpilePackages: ["@chronchaos/auth-registration", "@chronchaos/top-navigation"],
  async rewrites() {
    // The shared navigation owns login/register/logout, while CharacterGraph only
    // verifies the signed cookie. In local split-app development, proxy the
    // navigation's root-relative auth calls to the ChronChaos dev server.
    if (process.env.NODE_ENV !== "development" || !chronChaosAuthOrigin) return [];
    return [{
      source: "/api/auth/:path*",
      destination: `${chronChaosAuthOrigin}/api/auth/:path*`,
      basePath: false,
    }];
  },
  images: {
    formats: ["image/webp"],
  },
};

export default config;
