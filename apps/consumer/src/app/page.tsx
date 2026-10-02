import { Box, Container } from '@mantine/core';
import { Suspense } from 'react';
import BusinessInfoFooter from '@/components/BusinessInfoFooter';
import BusinessRelationshipNotice from '@/components/BusinessRelationshipNotice';
import HeroBanner from '@/components/HeroBanner';
import HomeHeader from '@/components/HomeHeader';
import HomeProductList from '@/components/HomeProductList';

// 홈 구성은 docs/specs/frontend/design-standard.md §5를 따른다.
// 사업자 관계 안내(카카오 채널 승인 증빙)는 상품 목록 아래에 둔다.
export default function HomePage() {
  return (
    <Container size="sm" px={0} pt={0} pb={96}>
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
