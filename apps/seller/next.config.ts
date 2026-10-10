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
  // Mantine은 Next 기본 최적화 목록에 없어 배럴 import가 쓰지 않는 컴포넌트까지 번들에 끌어온다.
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    remotePatterns: firebaseStorageImagePatterns(),
  },
};

// next-pwa 기본 precache 제외 규칙에 Pretendard 글자 범위 조각(92개, 약 3MB)을 더한다.
// 조각은 화면 글자에 필요한 것만 받으므로 서비스워커 설치 때 전부 미리 받지 않는다.
const precacheExclude = [
  /\/_next\/static\/.*(?<!\.p)\.woff2/,
  /\.map$/,
  /^manifest.*\.js$/,
  /PretendardVariable\.subset\.\d+\.[0-9a-f]+\.woff2$/,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withBundleAnalyzer(withPWA({
  dest: "public",
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  cleanupOutdatedCaches: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    exclude: precacheExclude,
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
