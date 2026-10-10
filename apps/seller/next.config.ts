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
  // 스크립트·스타일·연결 출처는 제한하지 않는 지시어만 둔다.
  {
    key: 'Content-Security-Policy',
    value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  },
];

// 이미지 최적화는 이 환경 Firebase 프로젝트의 Storage 버킷 이미지에만 허용한다.
// 업로드된 사진 URL은 두 버킷 별칭(appspot.com, firebasestorage.app) 중 하나를 쓴다.
function firebaseStorageImagePatterns() {
  const buckets = new Set<string>();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (projectId) {
    buckets.add(`${projectId}.appspot.com`);
    buckets.add(`${projectId}.firebasestorage.app`);
  }
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (bucket) buckets.add(bucket);
  return [...buckets].map((name) => ({
    protocol: 'https' as const,
    hostname: 'firebasestorage.googleapis.com',
    pathname: `/v0/b/${name}/o/**`,
  }));
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    remotePatterns: firebaseStorageImagePatterns(),
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
