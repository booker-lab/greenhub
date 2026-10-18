'use client';

import type { Product, ReviewSummary, SaleRoundItem, StorePublicProfile } from '@greenhub/shared';
import { Heart } from 'lucide-react';
import { createContext, type ReactNode, useContext } from 'react';
import { priceDropFromPreviousRound, previousRoundDropLabel } from '@/lib/benchmark-format';
import { isFeatureOn } from '@/lib/features';

// 회차 상품 카드에 붙는 벤치마킹 비교 기능(지난 회차 대비 가격·별점·판매자·보장·남은 수량·
// 이번 회차 찜).
// 크기 정보는 카드에 두지 않고 상품 상세에서만 보여 준다.
// 홈·상품 탭이 Provider로 상품 원본과 통계를 넘기고, 카드는 기능 토글이 켜진 것만 그린다.

export interface CardContextValue {
  productsById: ReadonlyMap<string, Product>;
  reviewStats: Record<string, ReviewSummary>;
  storeProfile: StorePublicProfile | null;
  /** 이번 회차 찜. roundId 회차의 카드에만 버튼을 단다. */
  wishlist?: { roundId: string; ids: ReadonlySet<string>; toggle: (productId: string) => void };
}

const CardContext = createContext<CardContextValue | null>(null);

export function BenchmarkCardProvider({ value, children }: { value: CardContextValue; children: ReactNode }) {
  return <CardContext.Provider value={value}>{children}</CardContext.Provider>;
}

export function useBenchmarkCard(): CardContextValue | null {
  return useContext(CardContext);
}

const smallText = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--fw-bold)',
  lineHeight: 1.4,
} as const;

/** 상품명 위 "이천 · 디어 오키드"(seller-store). */
export function CardSellerLine() {
  const ctx = useBenchmarkCard();
  if (!isFeatureOn('seller-store') || !ctx?.storeProfile) return null;
  const { region, name } = ctx.storeProfile;
  return (
    <div style={{ ...smallText, color: 'var(--color-primary-dark)', marginTop: 8 }}>
      {[region, name].filter(Boolean).join(' · ')}
    </div>
  );
}

/** 가격 아래 "지난 회차보다 N원 내렸어요"(card-discount). 가격 줄 안 끝에 넣는다. */
export function CardDiscount({ item }: { item: SaleRoundItem }) {
  const drop = isFeatureOn('card-discount')
    ? priceDropFromPreviousRound(item.previousRoundPrice, item.roundPrice)
    : null;
  if (!drop) return null;
  return (
    <span style={{ ...smallText, color: 'var(--color-primary-dark)', display: 'block' }}>
      {previousRoundDropLabel(drop)}
    </span>
  );
}

/** 가격 아래 별점·보장·남은 수량. */
export function CardMeta({ item, isPast }: { item: SaleRoundItem; isPast: boolean }) {
  const ctx = useBenchmarkCard();
  const product = ctx?.productsById.get(item.productId);
  const review = ctx?.reviewStats[item.productId];
  const showRating = isFeatureOn('reviews') && review && review.count > 0;
  const guaranteed =
    isFeatureOn('quality-guarantee') && product?.guaranteed && ctx?.storeProfile?.guarantee?.enabled;
  const remaining = isFeatureOn('demand-signals') && !isPast ? item.demand?.remainingQuantity : undefined;
  const lowStock = typeof remaining === 'number' && remaining > 0 && remaining <= 5;
  if (!showRating && !guaranteed && !lowStock) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {showRating && (
        <span style={smallText}>
          <span aria-hidden style={{ color: '#F5A524' }}>★</span> {review.average.toFixed(1)}{' '}
          <span style={{ fontWeight: 400 }}>({review.count})</span>
        </span>
      )}
      {(guaranteed || lowStock) && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {guaranteed && (
            <span style={{ ...tagStyle, background: 'var(--color-primary-surface)', color: 'var(--color-primary-dark)' }}>
              품질 보장
            </span>
          )}
          {lowStock && (
            <span style={{ ...tagStyle, background: 'var(--color-deadline-surface)', color: 'var(--color-deadline-text)' }}>
              {remaining}개 남음
            </span>
          )}
        </span>
      )}
    </div>
  );
}

const tagStyle = {
  borderRadius: 'var(--radius-tag)',
  display: 'inline-block',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--fw-bold)',
  padding: '2px 7px',
} as const;

/** 사진 왼쪽 위 이번 회차 찜 버튼(wishlist). 링크 밖 형제로 겹쳐 둔다. 지난 회차 카드에는 없다. */
export function CardWishButton({ productId, roundId, name }: { productId: string; roundId: string; name: string }) {
  const ctx = useBenchmarkCard();
  if (!isFeatureOn('wishlist') || !ctx?.wishlist || ctx.wishlist.roundId !== roundId) return null;
  const on = ctx.wishlist.ids.has(productId);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `${name} 찜 해제` : `${name} 찜하기`}
      onClick={() => ctx.wishlist?.toggle(productId)}
      style={{
        alignItems: 'center',
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        display: 'flex',
        height: 'var(--touch-target)',
        justifyContent: 'center',
        left: 2,
        padding: 0,
        pointerEvents: 'auto',
        position: 'absolute',
        top: 2,
        width: 'var(--touch-target)',
      }}
    >
      {/* 디자인 기준 §2: 빨강은 문제 상태에만 쓰므로 찜은 초록으로 채운다. */}
      <Heart
        size={22}
        aria-hidden
        strokeWidth={2}
        style={{
          color: on ? 'var(--color-primary)' : '#FFFFFF',
          fill: on ? 'var(--color-primary)' : 'rgba(0,0,0,0.25)',
        }}
      />
    </button>
  );
}
