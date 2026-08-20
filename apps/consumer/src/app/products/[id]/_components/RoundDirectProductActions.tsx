'use client';

import type { Product } from '@greenhub/shared';
import { ActionIcon, Box, Divider, Group, Paper, Stack, Text } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useState } from 'react';
import GreenLoveBrandSection from '@/components/GreenLoveBrandSection';
import ProductCTABar from '@/components/ProductCTABar';
import { type RoundCartItem, useCart } from '@/hooks/useCart';
import { useStore } from '@/hooks/useProducts';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
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
  const [cartError, setCartError] = useState<string | null>(null);
  const totalAmount = roundProduct.item.roundPrice * quantity;

  function handleAddToCart() {
    if (!roundProduct.isPurchasable) return;

    const result = addItem({
      productId: product.id,
      name: product.name,
      price: roundProduct.item.roundPrice,
      image: product.images?.[0] ?? '',
      saleType: 'normal',
      deliveryMethod: 'direct',
      storeId: product.storeId,
      quantity,
      roundId: roundProduct.item.roundId,
      roundItemId: roundProduct.item.id,
      roundPrice: roundProduct.item.roundPrice,
    });
    if (!result.ok) {
      setCartError(
        result.reason === 'different_round'
          ? '장바구니에는 같은 회차 상품만 담을 수 있습니다. 기존 장바구니를 비운 뒤 다시 시도해 주세요.'
          : result.reason === 'incompatible_cart'
            ? '기존 판매 상품과 회차 상품은 함께 담을 수 없습니다. 기존 장바구니를 비운 뒤 다시 시도해 주세요.'
            : '회차 상품 정보를 확인할 수 없어 장바구니에 담지 못했습니다.',
      );
      return;
    }
    setCartError(null);
    router.push('/cart');
  }

  function handleBuyNow() {
    if (!roundProduct.isPurchasable) return;

    const checkoutItem: RoundCartItem = {
      productId: product.id,
      name: product.name,
      price: roundProduct.item.roundPrice,
      image: product.images?.[0] ?? '',
      quantity,
      saleType: 'normal',
      deliveryMethod: 'direct',
      storeId: product.storeId,
      roundId: roundProduct.item.roundId,
      roundItemId: roundProduct.item.id,
      roundPrice: roundProduct.item.roundPrice,
    };
    try {
      sessionStorage.setItem('checkout_cart', JSON.stringify([checkoutItem]));
    } catch {
      setCartError('결제 정보를 저장하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.');
      return;
    }

    setCartError(null);
    const checkoutUrl = '/checkout?from=cart';
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
          <Stack gap={4} mt="sm">
            <Text size="sm" c="var(--color-text-secondary)">
              📍 {PUBLIC_BUSINESS_INFO.address}
            </Text>
            <Text size="sm" c="var(--color-text-secondary)">
              📞 {PUBLIC_BUSINESS_INFO.phone}
            </Text>
          </Stack>
        </Box>
      )}

      {cartError && (
        <Text role="alert" mt="md" c="red" size="sm">
          {cartError}
        </Text>
      )}

      <ProductCTABar
        totalAmount={totalAmount}
        isGroup={false}
        isUnavailable={!roundProduct.isPurchasable}
        unavailableLabel="주문 마감"
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
