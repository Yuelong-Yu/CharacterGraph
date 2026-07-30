import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const config: NextConfig = {
  basePath,
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  transpilePackages: ["@chronchaos/auth-registration", "@chronchaos/top-navigation"],
  images: {
    formats: ["image/webp"],
  },
};

export default config;
