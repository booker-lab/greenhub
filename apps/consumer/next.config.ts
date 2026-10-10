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
  // 스크립트·스타일·연결 출처는 제한하지 않는 지시어만 둔다. 모바일 결제는 결제사로
  // 폼을 제출하며 이동하므로 form-action은 두지 않는다.
  {
    key: 'Content-Security-Policy',
    value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  },
];

// 이미지 최적화는 이 환경 Firebase 프로젝트의 Storage 버킷 이미지에만 허용한다.
// 판매자 앱이 올린 상품 사진 URL은 두 버킷 별칭(appspot.com, firebasestorage.app) 중 하나를 쓴다.
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
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    remotePatterns: firebaseStorageImagePatterns(),
  },
};

// 서비스워커가 API 응답(주소·전화·이름·주문, 알림)과 세션(accessToken)을 Cache Storage에
// 남기거나 다른 사용자에게 돌려주지 않도록 API·인증·배송 사진 요청은 NetworkOnly로 고정한다.
// runtimeCaching 함수는 sw.js로 직렬화되므로 외부 변수를 참조하지 않고, API origin은 빌드 시 RegExp로 굳힌다.
// 이전 버전이 남긴 캐시는 worker/index.js가 새 서비스워커 활성화 때 지운다.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveApiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').origin;
  } catch {
    return 'http://localhost:3000';
  }
}

const apiOriginPattern = new RegExp(`^${escapeRegExp(resolveApiOrigin())}/`);

export const networkOnlyRuntimeCaching = [
  // 소비자 API 도메인 전체(/auth/me, 주소록, 주문, 알림 등)
  {
    urlPattern: apiOriginPattern,
    handler: 'NetworkOnly' as const,
    options: { cacheName: 'consumer-api-network-only' },
  },
  // Bearer 토큰을 실은 요청은 도메인 설정과 무관하게 캐시하지 않는다
  {
    urlPattern: ({ request }: { request: Request }) => request.headers.has('Authorization'),
    handler: 'NetworkOnly' as const,
    options: { cacheName: 'authorized-network-only' },
  },
  // 같은 출처 /api/*(NextAuth 세션 등) — 기본 "apis" NetworkFirst 규칙을 대체한다
  {
    urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith('/api/'),
    handler: 'NetworkOnly' as const,
    options: { cacheName: 'apis' },
  },
  // 배송 사진(서명 URL, Storage deliveryPhotos 경로)
  {
    urlPattern: ({ url }: { url: URL }) =>
      url.searchParams.has('X-Goog-Signature') || url.pathname.includes('deliveryPhotos'),
    handler: 'NetworkOnly' as const,
    options: { cacheName: 'delivery-photo-network-only' },
  },
];

// next-pwa 기본 precache 제외 규칙에 Pretendard 글자 범위 조각(92개, 약 3MB)을 더한다.
// 조각은 화면 글자에 필요한 것만 받으므로 서비스워커 설치 때 전부 미리 받지 않는다.
const precacheExclude = [
  /\/_next\/static\/.*(?<!\.p)\.woff2/,
  /\.map$/,
  /^manifest.*\.js$/,
  /PretendardVariable\.subset\.\d+\.[0-9a-f]+\.woff2$/,
];

export default withBundleAnalyzer(withPWA({
  dest: "public",
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  // 위 NetworkOnly 규칙을 앞에 두고, 정적 자산 등 나머지 기본 규칙은 그대로 유지한다
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    exclude: precacheExclude,
    runtimeCaching: networkOnlyRuntimeCaching,
  },
})(nextConfig));
