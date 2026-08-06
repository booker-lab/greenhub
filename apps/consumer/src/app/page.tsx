import { Container } from '@mantine/core';
import BrandHeader from '@/components/BrandHeader';
import BusinessInfoFooter from '@/components/BusinessInfoFooter';
import BusinessRelationshipNotice from '@/components/BusinessRelationshipNotice';
import HeroBanner from '@/components/HeroBanner';
import HomeProductList from '@/components/HomeProductList';

export default function HomePage() {
  return (
    <Container size="sm" px="md" pt="lg" pb={96}>
      <BrandHeader />
      <HeroBanner />
      <BusinessRelationshipNotice />
      <HomeProductList />
      <BusinessInfoFooter />
    </Container>
  );
}
