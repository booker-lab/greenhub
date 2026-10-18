'use client';

import type { Product } from '@greenhub/shared';
import { ActionIcon, Box, Button, Divider, Group, Stack, Text } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useState } from 'react';
import GreenLoveBrandSection from '@/components/GreenLoveBrandSection';
import ProductCTABar from '@/components/ProductCTABar';
import { type RoundCartItem, useCart } from '@/hooks/useCart';
import { useStore } from '@/hooks/useProducts';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import { cartAddFailureMessage } from '@/lib/round-quick-add';
import OptionSheet, { type OptionSelection } from '@/components/benchmark/OptionSheet';
import KakaoChannelCta from '@/components/benchmark/KakaoChannelCta';
import { useRestockSubscriptions, useRoundWishlist } from '@/hooks/useBenchmark';
import { isFeatureOn } from '@/lib/features';
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
  // 옵션 시트(option-sheet): 옵션이 있는 상품은 담기·바로 구매 전에 시트에서 옵션을 고른다.
  const optionGroups = isFeatureOn('option-sheet') ? (product.options ?? []) : [];
  const [sheetIntent, setSheetIntent] = useState<'cart' | 'buy' | null>(null);
  // 이번 회차 찜(wishlist): 지금 회차 상품에만 단다. 지난 회차·품절 상품은 다음 회차 알림 신청으로 받는다.
  const wishRoundId = roundProduct.state === 'current' ? roundProduct.item.roundId : null;
  const showWish = isFeatureOn('wishlist') && wishRoundId !== null;
  const wishlist = useRoundWishlist(wishRoundId, isFeatureOn('wishlist'));
  const restock = useRestockSubscriptions(isFeatureOn('restock-alert'));
  const showRestock = isFeatureOn('restock-alert') && !roundProduct.isPurchasable;
  const totalAmount = roundProduct.item.roundPrice * quantity;
  const notOpenYet = roundProduct.state === 'current' && roundProduct.round?.status === 'SCHEDULED';
  const soldOut = roundProduct.state === 'sold_out';

  function optionFields(selection?: OptionSelection) {
    return selection
      ? {
          price: roundProduct.item.roundPrice + selection.priceDelta,
          optionChoiceIds: selection.choiceIds,
          optionLabel: selection.label,
          optionPriceDelta: selection.priceDelta,
          ...(selection.text ? { optionText: selection.text } : {}),
        }
      : { price: roundProduct.item.roundPrice };
  }

  function handleAddToCart(selection?: OptionSelection, chosenQuantity = quantity) {
    if (!roundProduct.isPurchasable) return;
    if (optionGroups.length > 0 && !selection) {
      setSheetIntent('cart');
      return;
    }

    const result = addItem({
      productId: product.id,
      name: product.name,
      image: product.images?.[0] ?? '',
      saleType: 'normal',
      deliveryMethod: 'direct',
      storeId: product.storeId,
      quantity: chosenQuantity,
      roundId: roundProduct.item.roundId,
      roundItemId: roundProduct.item.id,
      roundPrice: roundProduct.item.roundPrice,
      ...optionFields(selection),
    });
    if (!result.ok) {
      setCartError(cartAddFailureMessage(result.reason));
      return;
    }
    setCartError(null);
    router.push('/cart');
  }

  function handleBuyNow(selection?: OptionSelection, chosenQuantity = quantity) {
    if (!roundProduct.isPurchasable) return;
    if (optionGroups.length > 0 && !selection) {
      setSheetIntent('buy');
      return;
    }

    const checkoutItem: RoundCartItem = {
      productId: product.id,
      name: product.name,
      ...optionFields(selection),
      image: product.images?.[0] ?? '',
      quantity: chosenQuantity,
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
      <Group
        justify="space-between"
        wrap="nowrap"
        mt="md"
        mb="lg"
        py="sm"
        style={{ borderTop: 'var(--border)', borderBottom: 'var(--border)' }}
      >
        <Text
          style={{
            fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
          }}
        >
          수량
        </Text>
        <Group
          gap={4}
          wrap="nowrap"
          px={4}
          style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-full)' }}
        >
          <ActionIcon
            size={40}
            variant="subtle"
            color="dark"
            radius="xl"
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
            style={{
              fontSize: 'var(--font-size-md)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 'var(--fw-extrabold)',
            }}
          >
            {quantity}
          </Text>
          <ActionIcon
            size={40}
            variant="subtle"
            color="dark"
            radius="xl"
            aria-label="수량 늘리기"
            disabled={!roundProduct.isPurchasable}
            onClick={() => setQuantity(Math.min(99, quantity + 1))}
          >
            +
          </ActionIcon>
        </Group>
      </Group>

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

      {(showWish || showRestock) && (
        <Group gap={8} mt="lg" wrap="nowrap">
          {showWish && (
            <Button
              variant={wishlist.ids.has(product.id) ? 'filled' : 'outline'}
              radius="xl"
              flex={1}
              aria-pressed={wishlist.ids.has(product.id)}
              onClick={() => wishlist.toggle(product.id)}
            >
              {wishlist.ids.has(product.id) ? '이번 회차 찜함' : '이번 회차 찜하기'}
            </Button>
          )}
          {showRestock && (
            <Button
              variant={restock.ids.has(product.id) ? 'filled' : 'outline'}
              radius="xl"
              flex={2}
              aria-pressed={restock.ids.has(product.id)}
              onClick={() => void restock.toggle(product.id)}
            >
              {restock.ids.has(product.id) ? '다음 회차 알림 신청함' : '다음 회차에 다시 보고 싶어요'}
            </Button>
          )}
        </Group>
      )}
      {showWish && (
        <Text mt={6} size="sm" c="var(--color-text-secondary)">
          찜은 이 휴대폰에만 남고, 이번 회차가 끝나면 비워져요.
        </Text>
      )}
      {showRestock && (
        <Text mt={6} size="sm" c="var(--color-text-secondary)">
          신청 수는 판매자가 다음 회차 상품을 고를 때 참고해요. 알림 문자는 아직 보내지 않아요.
        </Text>
      )}
      {(showWish || showRestock) && (
        // 다음 회차 소식은 카카오톡 채널로 받는다(찜·알림 신청은 회차가 바뀌면 이어지지 않는다).
        <Box mt="sm">
          <KakaoChannelCta
            compact
            title="다음 회차 소식은 카카오톡 채널로 받아 보세요"
          />
        </Box>
      )}

      {cartError && (
        <Text role="alert" mt="md" c="red" size="sm">
          {cartError}
        </Text>
      )}

      {optionGroups.length > 0 && (
        <OptionSheet
          opened={sheetIntent !== null}
          onClose={() => setSheetIntent(null)}
          groups={optionGroups}
          basePrice={roundProduct.item.roundPrice}
          initialQuantity={quantity}
          intent={sheetIntent ?? 'cart'}
          onConfirm={(selection, chosenQuantity, intent) => {
            setSheetIntent(null);
            if (intent === 'cart') handleAddToCart(selection, chosenQuantity);
            else handleBuyNow(selection, chosenQuantity);
          }}
        />
      )}

      <ProductCTABar
        totalAmount={totalAmount}
        isGroup={false}
        isUnavailable={!roundProduct.isPurchasable}
        unavailableLabel={soldOut ? '품절' : notOpenYet ? '주문 시작 전' : '주문 마감'}
        canBuy={roundProduct.isPurchasable}
        canAddToCart={roundProduct.isPurchasable}
        addToCartLabel="장바구니"
        buyNowLabel={roundProduct.isPurchasable ? '바로 구매' : undefined}
        onAddToCart={() => handleAddToCart()}
        onBuyNow={() => handleBuyNow()}
      />
    </Stack>
  );
}
