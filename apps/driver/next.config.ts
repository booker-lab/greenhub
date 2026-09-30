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

const pilotPhotoPermissionsPolicy = {
  key: 'Permissions-Policy',
  value: 'camera=(self), microphone=(), geolocation=()',
};

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/board/:orderId/photo/round-direct',
        headers: [pilotPhotoPermissionsPolicy],
      },
    ];
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

// 서비스워커가 API 응답(주소·전화 등 개인정보, 배송 상태)을 Cache Storage에 남기거나
// 전파가 약할 때 오래된 응답을 최신처럼 돌려주지 않도록 API·인증 요청은 NetworkOnly로 고정한다.
// runtimeCaching 함수는 sw.js로 직렬화되므로 외부 변수를 참조하지 않고, API origin은 빌드 시 RegExp로 굳힌다.
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

const networkOnlyRuntimeCaching = [
  // 드라이버 API 도메인 전체(/driver/orders, 상세, 인증 토큰 교환 등)
  {
    urlPattern: apiOriginPattern,
    handler: 'NetworkOnly' as const,
    options: { cacheName: 'driver-api-network-only' },
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
];

export default withBundleAnalyzer(withPWA({
  dest: "public",
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  // 전파 복구 시 자동 새로고침이 진행 중인 사진 업로드를 끊지 않도록 끈다
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
  // 위 NetworkOnly 규칙을 앞에 두고, 정적 자산 등 나머지 기본 규칙은 그대로 유지한다
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: networkOnlyRuntimeCaching,
  },
})(nextConfig));
