import { Suspense } from 'react';
import BusinessInfoFooter from '@/components/BusinessInfoFooter';
import BusinessRelationshipNotice from '@/components/BusinessRelationshipNotice';
import HeroBanner from '@/components/HeroBanner';
import HomeHeader from '@/components/HomeHeader';
import HomeProductList from '@/components/HomeProductList';
import { HomeStorePrefetch } from '@/components/home-store-prefetch';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import { SITE_URL } from '@/lib/share-metadata';
import { buildSiteJsonLd, serializeJsonLd } from '@/lib/structured-data';
import { loadHomeStoreHint } from './home-server';

const siteJsonLd = serializeJsonLd(
  buildSiteJsonLd(PUBLIC_BUSINESS_INFO, SITE_URL, `${SITE_URL}/icons/icon-512x512.png`),
);

// 서버가 아는 매장 단서로 브라우저가 상품 목록·판매 방식·회차를 함께 조회하게 한다.
// 단서 조회는 Suspense로 흘려보내 페이지 첫 HTML을 막지 않는다.
async function HomeStoreHint() {
  const storeId = await loadHomeStoreHint();
  return storeId ? <HomeStorePrefetch storeId={storeId} /> : null;
}

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px, 좌우 0·아래 96)·Box(좌우 md 16·위 40)와 같은 값.
// 홈 구성은 docs/specs/frontend/design-standard.md §5를 따른다.
// 사업자 관계 안내(카카오 채널 승인 증빙)는 상품 목록 아래에 둔다.
export default function HomePage() {
  return (
    <div className="mx-auto max-w-[720px] px-0 pt-0 pb-24">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: serializeJsonLd가 `<`를 이스케이프해 태그를 닫을 수 없다
        dangerouslySetInnerHTML={{ __html: siteJsonLd }}
      />
      <HomeHeader />
      <Suspense fallback={null}>
        <HomeStoreHint />
      </Suspense>
      <Suspense fallback={null}>
        <HomeProductList banner={<HeroBanner />} />
      </Suspense>
      <div className="mt-10 px-4">
        <BusinessRelationshipNotice />
        <BusinessInfoFooter />
      </div>
    </div>
  );
}
