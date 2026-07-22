import { Container } from '@mantine/core';
import { Suspense } from 'react';
import BrandHeader from '@/components/BrandHeader';
import HeroBanner from '@/components/HeroBanner';
import HomeProductList from '@/components/HomeProductList';

export default function HomePage() {
  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      <BrandHeader />
      <HeroBanner />
      <Suspense fallback={null}>
        <HomeProductList />
      </Suspense>
    </Container>
  );
}
