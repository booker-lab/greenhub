import { Box, Container } from '@mantine/core';
import { Suspense } from 'react';
import BusinessInfoFooter from '@/components/BusinessInfoFooter';
import BusinessRelationshipNotice from '@/components/BusinessRelationshipNotice';
import HeroBanner from '@/components/HeroBanner';
import HomeHeader from '@/components/HomeHeader';
import HomeProductList from '@/components/HomeProductList';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import { SITE_URL } from '@/lib/share-metadata';
import { buildSiteJsonLd, serializeJsonLd } from '@/lib/structured-data';

const siteJsonLd = serializeJsonLd(
  buildSiteJsonLd(PUBLIC_BUSINESS_INFO, SITE_URL, `${SITE_URL}/icons/icon-512x512.png`),
);

// 홈 구성은 docs/specs/frontend/design-standard.md §5를 따른다.
// 사업자 관계 안내(카카오 채널 승인 증빙)는 상품 목록 아래에 둔다.
export default function HomePage() {
  return (
    <Container size="sm" px={0} pt={0} pb={96}>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: serializeJsonLd가 `<`를 이스케이프해 태그를 닫을 수 없다
        dangerouslySetInnerHTML={{ __html: siteJsonLd }}
      />
      <HomeHeader />
      <Suspense fallback={null}>
        <HomeProductList banner={<HeroBanner />} />
      </Suspense>
      <Box px="md" mt={40}>
        <BusinessRelationshipNotice />
        <BusinessInfoFooter />
      </Box>
    </Container>
  );
}
