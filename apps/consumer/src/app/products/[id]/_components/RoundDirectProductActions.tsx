'use client';

import type { Product } from '@greenhub/shared';
import { ActionIcon, Box, Divider, Group, Paper, Stack, Text } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useState } from 'react';
import GreenLoveBrandSection from '@/components/GreenLoveBrandSection';
import ProductCTABar from '@/components/ProductCTABar';
import { useCart } from '@/hooks/useCart';
import { useStore } from '@/hooks/useProducts';
import type { RoundProductActionContext } from './ProductActions';

interface Props {
  product: Product;
  roundProduct: RoundProductActionContext;
}

export default function RoundDirectProductActions({ product, roundProduct }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const { addItem } = useCart();
  const { store } = useStore(product.storeId ?? null);
  const [quantity, setQuantity] = useState(1);
  const totalAmount = roundProduct.item.roundPrice * quantity;

  function handleAddToCart() {
    if (!roundProduct.isPurchasable) return;

    addItem({
      productId: product.id,
      name: product.name,
      price: roundProduct.item.roundPrice,
      image: product.images?.[0] ?? '',
      saleType: 'normal',
      deliveryMethod: 'direct',
      storeId: product.storeId,
      quantity,
    });
    router.push('/cart');
  }

  function handleBuyNow() {
    if (!roundProduct.isPurchasable) return;

    const parameters = new URLSearchParams({
      productId: product.id,
      quantity: String(quantity),
      saleType: 'normal',
      deliveryMethod: 'direct',
      totalAmount: String(totalAmount),
    });
    const checkoutUrl = `/checkout?${parameters.toString()}`;
    if (!session) {
      signIn(undefined, { callbackUrl: checkoutUrl });
      return;
    }
    router.push(checkoutUrl);
  }

  return (
    <Stack gap={0} px="md" pb={88}>
      <Paper radius="md" p="md" mb="lg" style={{ background: 'var(--color-surface-muted)' }}>
        <Text
          mb="sm"
          style={{
            fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
          }}
        >
          수량
        </Text>
        <Group gap="sm">
          <ActionIcon
            size="lg"
            variant="default"
            radius="md"
            aria-label="수량 줄이기"
            disabled={!roundProduct.isPurchasable}
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
          >
            −
          </ActionIcon>
          <Text
            w={32}
            ta="center"
            aria-live="polite"
            style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--fw-bold)' }}
          >
            {quantity}
          </Text>
          <ActionIcon
            size="lg"
            variant="default"
            radius="md"
            aria-label="수량 늘리기"
            disabled={!roundProduct.isPurchasable}
            onClick={() => setQuantity(Math.min(99, quantity + 1))}
          >
            +
          </ActionIcon>
        </Group>
      </Paper>

      <Divider mb="xl" />
      <Box mb="xl">
        <GreenLoveBrandSection />
      </Box>

      {store && (
        <Box pt="xl" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Text
            mb="sm"
            style={{
              fontWeight: 'var(--fw-bold)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            판매자 정보
          </Text>
          <Text size="sm" fw="var(--fw-bold)">
            {store.name}
          </Text>
          <Text size="sm" c="var(--color-text-secondary)">
            {store.ceoName}
          </Text>
          <Stack gap={4} mt="sm">
            <Text size="sm" c="var(--color-text-secondary)">
              📍 {store.address}
            </Text>
            <Text size="sm" c="var(--color-text-secondary)">
              📞 {store.phone}
            </Text>
          </Stack>
        </Box>
      )}

      <ProductCTABar
        totalAmount={totalAmount}
        isGroup={false}
        isFull={roundProduct.state === 'closed'}
        canBuy={roundProduct.isPurchasable}
        canAddToCart={roundProduct.isPurchasable}
        addToCartLabel="장바구니 담기"
        buyNowLabel="바로 구매"
        onAddToCart={handleAddToCart}
        onBuyNow={handleBuyNow}
      />
    </Stack>
  );
}
