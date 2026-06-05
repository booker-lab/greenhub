import type { Product } from '@greenhub/shared';
import { Box, Container } from '@mantine/core';
import { notFound } from 'next/navigation';
import ProductActions from '@/app/products/[id]/_components/ProductActions';
import ProductTopBar from '@/components/ProductTopBar';

const PRODUCT: Product = {
  id: 'fixture-product-alpha',
  storeId: 'store-alpha',
  name: 'Fixture orchid',
  images: ['/icons/icon-192x192.png'],
  price: 32000,
  category: 'orchid',
  saleType: 'normal',
  deliverySize: 'small',
  isActive: true,
  createdAt: '2026-06-04T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:00.000Z',
};

export default function StoreProductDetailFixturePage() {
  if (process.env.ENABLE_E2E_FIXTURES !== 'true') notFound();

  return (
    <Container size="sm" p={0}>
      <ProductTopBar backHref="/stores/store-alpha" backLabel="상점으로" />
      <Box style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}>
        <Box style={{ height: 16 }} />
        <ProductActions product={PRODUCT} initialDeliveryMethod="parcel" />
      </Box>
    </Container>
  );
}
