import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withBundleAnalyzer(withPWA({
  dest: "public",
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  cleanupOutdatedCaches: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    runtimeCaching: [
      // Firestore WebChannel — 캐시 불가
      {
        urlPattern: /firestore\.googleapis\.com/,
        handler: 'NetworkOnly',
      },
      // Next.js JS 청크 — 구 캐시로 인한 404 방지
      {
        urlPattern: /\/_next\/static\/chunks\//,
        handler: 'NetworkFirst',
      },
    ],
  },
} as any)(nextConfig));
