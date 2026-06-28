import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const config: NextConfig = {
  basePath,
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  images: {
    formats: ["image/webp"],
  },
};

export default config;
