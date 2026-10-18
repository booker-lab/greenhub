import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/share-metadata';

// 로그인한 사람만 쓰는 화면(주문·장바구니·결제·내 정보)과 로그인·API 경로는 검색 대상에서 뺀다.
const PRIVATE_PATHS = ['/mypage', '/cart', '/checkout', '/order', '/login', '/api/'];

export default function robots(): MetadataRoute.Robots {
  // Vercel Preview 주소가 검색에 잡혀 운영 주소와 겹치지 않도록 운영 빌드에서만 수집을 허용한다.
  if (process.env.VERCEL_ENV !== 'production') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
