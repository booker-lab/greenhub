import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  cleanupOutdatedCaches: true,
  disable: process.env.NODE_ENV === "development",
  customWorkerSrc: "worker",
} as any)(nextConfig);
