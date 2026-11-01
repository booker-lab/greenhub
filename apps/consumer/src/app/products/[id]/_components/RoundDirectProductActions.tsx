'use client';

import type { Product } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import KakaoChannelCta from '@/components/benchmark/KakaoChannelCta';
import OptionSheet, { type OptionSelection } from '@/components/benchmark/OptionSheet';
import GreenLoveBrandSection from '@/components/GreenLoveBrandSection';
import ProductCTABar from '@/components/ProductCTABar';
import { useRestockSubscriptions, useRoundWishlist } from '@/hooks/useBenchmark';
import { type RoundCartItem, useCart } from '@/hooks/useCart';
import { useStore } from '@/hooks/useProducts';
import { fetchOptionAvailability } from '@/lib/benchmark-api';
import { isFeatureOn } from '@/lib/features';
import { type OptionAvailabilityMap, toAvailabilityMap } from '@/lib/option-availability';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import { cartAddFailureMessage } from '@/lib/round-quick-add';
import type { RoundProductActionContext } from './ProductActions';

interface Props {
  product: Product;
  roundProduct: RoundProductActionContext;
}

// Mantine ActionIcon(size 40·subtle dark·radius xl) 계산값: 40px 정사각, 모서리 32px, 투명 1px 테두리, dark-9 글자,
// 줄 높이 1, 글꼴은 물려받는다. hover(가능한 기기만) dark-2 면, 비활성은 gray-2 면·gray-5 글자.
const QUANTITY_BUTTON =
  'relative m-0 inline-flex size-10 min-h-10 min-w-10 cursor-pointer appearance-none items-center justify-center overflow-hidden rounded-[32px] border border-solid border-transparent bg-transparent p-0 text-left leading-none text-[#141414] no-underline select-none [font-family:inherit] [font-size:inherit] [font-weight:inherit] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid active:translate-y-px enabled:[@media(hover:hover)]:hover:bg-[#828282] disabled:cursor-not-allowed disabled:bg-[#e9ecef] disabled:text-[#adb5bd] disabled:active:translate-y-0';

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
  // 직접 출력한 화분처럼 재고에 연결된 선택지의 남은 수량. 시트를 열 때마다 새로 불러온다.
  const [optionAvailability, setOptionAvailability] = useState<OptionAvailabilityMap | null>(null);
  const hasStockLinkedOption = optionGroups.some((group) =>
    group.choices.some((choice) => !!choice.stockId),
  );
  const sheetOpened = sheetIntent !== null;
  useEffect(() => {
    if (!sheetOpened || !hasStockLinkedOption) return;
    let cancelled = false;
    setOptionAvailability(null);
    fetchOptionAvailability(product.id)
      .then((body) => {
        if (!cancelled) setOptionAvailability(toAvailabilityMap(body));
      })
      .catch(() => {
        // 못 불러오면 제한 없이 그린다. 모자란 재고는 주문할 때 서버가 막고 안내한다.
      });
    return () => {
      cancelled = true;
    };
  }, [hasStockLinkedOption, product.id, sheetOpened]);
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
    // ① 외형 유지(UI 교체 P5): Mantine Stack(gap 0·px md·pb 88)·Group·Text(16/1.55, sm 15/1.45)·Divider·Button 계산값.
    <div className="flex flex-col items-stretch justify-start gap-0 px-4 pb-[88px]">
      <div
        className="mt-4 mb-5 flex flex-row flex-nowrap items-center justify-between gap-4 py-3"
        style={{ borderTop: 'var(--border)', borderBottom: 'var(--border)' }}
      >
        <p
          className="m-0 p-0 leading-[1.55]"
          style={{
            fontWeight: 'var(--fw-bold)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
          }}
        >
          수량
        </p>
        <div
          className="flex flex-row flex-nowrap items-center justify-start gap-1 px-1"
          style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-full)' }}
        >
          <button
            type="button"
            className={QUANTITY_BUTTON}
            aria-label="수량 줄이기"
            disabled={!roundProduct.isPurchasable}
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
          >
            −
          </button>
          <p
            className="m-0 w-8 p-0 text-center leading-[1.55] font-normal"
            aria-live="polite"
            style={{
              fontSize: 'var(--font-size-md)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 'var(--fw-extrabold)',
            }}
          >
            {quantity}
          </p>
          <button
            type="button"
            className={QUANTITY_BUTTON}
            aria-label="수량 늘리기"
            disabled={!roundProduct.isPurchasable}
            onClick={() => setQuantity(Math.min(99, quantity + 1))}
          >
            +
          </button>
        </div>
      </div>

      {/* Mantine Divider: 1px gray-3 윗선, 역할 separator(가로) */}
      <hr className="m-0 mb-8 h-0 border-0 border-t border-solid border-[#dee2e6]" />
      <div className="mb-8">
        <GreenLoveBrandSection />
      </div>

      {store && (
        <div className="pt-8" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p
            className="m-0 mb-3 p-0 leading-[1.55]"
            style={{
              fontWeight: 'var(--fw-bold)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            판매자 정보
          </p>
          <p className="m-0 p-0 text-sm" style={{ fontWeight: 'var(--fw-bold)' }}>
            {store.name}
          </p>
          <div className="mt-3 flex flex-col items-stretch justify-start gap-1">
            <p
              className="m-0 p-0 text-sm font-normal"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              📍 {PUBLIC_BUSINESS_INFO.address}
            </p>
            <p
              className="m-0 p-0 text-sm font-normal"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              📞 {PUBLIC_BUSINESS_INFO.phone}
            </p>
          </div>
        </div>
      )}

      {(showWish || showRestock) && (
        <div className="mt-5 flex flex-row flex-nowrap items-center justify-start gap-2">
          {showWish && (
            <Button
              variant={wishlist.ids.has(product.id) ? 'default' : 'outline'}
              className="flex-1"
              aria-pressed={wishlist.ids.has(product.id)}
              onClick={() => wishlist.toggle(product.id)}
            >
              {wishlist.ids.has(product.id) ? '이번 회차 찜함' : '이번 회차 찜하기'}
            </Button>
          )}
          {showRestock && (
            <Button
              variant={restock.ids.has(product.id) ? 'default' : 'outline'}
              className="flex-[2]"
              aria-pressed={restock.ids.has(product.id)}
              onClick={() => void restock.toggle(product.id)}
            >
              {restock.ids.has(product.id)
                ? '다음 회차 알림 신청함'
                : '다음 회차에 다시 보고 싶어요'}
            </Button>
          )}
        </div>
      )}
      {showWish && (
        <p
          className="m-0 mt-1.5 p-0 text-sm font-normal"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          찜은 이 휴대폰에만 남고, 이번 회차가 끝나면 비워져요.
        </p>
      )}
      {showRestock && (
        <p
          className="m-0 mt-1.5 p-0 text-sm font-normal"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          신청 수는 판매자가 다음 회차 상품을 고를 때 참고해요. 알림 문자는 아직 보내지 않아요.
        </p>
      )}
      {(showWish || showRestock) && (
        // 다음 회차 소식은 카카오톡 채널로 받는다(찜·알림 신청은 회차가 바뀌면 이어지지 않는다).
        <div className="mt-3">
          <KakaoChannelCta compact title="다음 회차 소식은 카카오톡 채널로 받아 보세요" />
        </div>
      )}

      {cartError && (
        <p role="alert" className="m-0 mt-4 p-0 text-sm font-normal" style={{ color: '#fa5252' }}>
          {cartError}
        </p>
      )}

      {optionGroups.length > 0 && (
        <OptionSheet
          opened={sheetIntent !== null}
          onClose={() => setSheetIntent(null)}
          groups={optionGroups}
          basePrice={roundProduct.item.roundPrice}
          initialQuantity={quantity}
          intent={sheetIntent ?? 'cart'}
          availability={optionAvailability}
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
    </div>
  );
}
