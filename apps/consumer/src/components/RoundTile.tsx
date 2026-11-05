'use client';

import type { SaleRoundItem } from '@greenhub/shared';
import Link from 'next/link';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import type { PublicSaleRound } from '@/hooks/useSaleRounds';
import { dogamLabel } from '@/lib/dogam-label';
import { isFeatureOn } from '@/lib/features';
import { canQuickAdd } from '@/lib/round-quick-add';
import {
  CardDiscount,
  CardMeta,
  CardSellerLine,
  CardWishButton,
  useBenchmarkCard,
} from './benchmark/CardExtras';

// 회차 상품 도감 타일(design-direction.md §4.1, §8 D1). 홈·상품 탭이 함께 쓴다.
// - 연회색 단색 타일 위 4:5 사진, 타일 밖 아래에 이름 → 가격(+ 남은 수량) → 도감 라벨.
// - 7개마다(index % 7 === 0) 한 상품을 2칸 크기로 키운다. 높이는 한 행이라 사진은 8:5다(2칸 폭 × 5/8 = 1칸 폭 × 5/4).
// - 타일마다 붙던 도착·판매 예정·판매 종료 태그는 없다. 품절과 열린 회차 안의 판매 종료 상품은 그리드에서 빼
//   그리드 아래 한 줄 목록으로 모은다. 지난 회차는 회차 전체가 끝난 기록이라 그대로 그리드에 둔다.

const FEATURE_EVERY = 7;

export function isFeatureTile(index: number) {
  return index % FEATURE_EVERY === 0;
}

/** 그리드에서 빼서 아래 한 줄로 모을 상품의 표시 이름. 그리드에 둘 상품이면 null. */
export function unavailableLabel(
  item: SaleRoundItem,
  round: PublicSaleRound,
  isPast: boolean,
): '품절' | '판매 종료' | null {
  if (isPast) return null;
  if (item.status === 'SOLD_OUT') return '품절';
  if (round.status === 'OPEN' && item.status === 'CLOSED') return '판매 종료';
  return null;
}

function roundItemHref(item: SaleRoundItem, round: PublicSaleRound) {
  return `/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`;
}

const smallLabel = {
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--fw-bold)',
  lineHeight: 1.4,
} as const;

/** 가격 줄 오른쪽 "n개 남음"(demand-signals, 1~5개). 검정 굵은 글자(§3.2: 노랑은 마감에만). */
function LowStock({ item, isPast }: { item: SaleRoundItem; isPast: boolean }) {
  const remaining =
    isFeatureOn('demand-signals') && !isPast ? item.demand?.remainingQuantity : undefined;
  if (typeof remaining !== 'number' || remaining <= 0 || remaining > 5) return null;
  return (
    <span
      style={{
        ...smallLabel,
        color: 'var(--color-text)',
        flexShrink: 0,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {remaining}개 남음
    </span>
  );
}

function DogamLabel({ productId }: { productId: string }) {
  const product = useBenchmarkCard()?.productsById.get(productId);
  const label = dogamLabel(product);
  if (!label) return null;
  return (
    <p
      className="m-0 mt-1 truncate p-0"
      style={{ ...smallLabel, color: 'var(--color-text-secondary)' }}
    >
      {label}
    </p>
  );
}

const overlayStyle = (ratio: string) =>
  ({
    aspectRatio: ratio,
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    width: '100%',
  }) as const;

function RoundTile({
  item,
  round,
  isPast,
  feature,
  ariaLabel,
  onQuickAdd,
}: {
  item: SaleRoundItem;
  round: PublicSaleRound;
  isPast: boolean;
  feature: boolean;
  ariaLabel?: string;
  onQuickAdd?: (item: SaleRoundItem) => void;
}) {
  const ratio = feature ? '8/5' : '4/5';
  const quickAdd = onQuickAdd && canQuickAdd(item, round.status, isPast) ? onQuickAdd : null;

  return (
    <div
      className={feature ? 'col-span-2' : undefined}
      style={{ position: 'relative', minWidth: 0 }}
    >
      <Link
        href={roundItemHref(item, round)}
        aria-label={ariaLabel}
        style={{ display: 'block', minWidth: 0, color: 'inherit', textDecoration: 'none' }}
      >
        <div
          style={{
            position: 'relative',
            aspectRatio: ratio,
            overflow: 'hidden',
            borderRadius: 'var(--radius)',
            background: 'var(--color-surface-muted)',
            opacity: isPast ? 0.6 : 1,
          }}
        >
          <ResilientImage
            fill
            src={item.productImageUrlSnapshot ?? PRODUCT_IMAGE_FALLBACK}
            fallbackSrc={PRODUCT_IMAGE_FALLBACK}
            alt={item.productNameSnapshot}
            sizes={feature ? '(max-width: 600px) 100vw, 66vw' : '(max-width: 600px) 50vw, 33vw'}
            style={{ objectFit: 'cover' }}
          />
        </div>
        <CardSellerLine />
        <p
          className={`m-0 line-clamp-2 text-ellipsis p-0 ${isFeatureOn('seller-store') ? 'mt-0.5' : 'mt-2'}`}
          style={{
            color: 'var(--color-text)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            lineHeight: 1.35,
          }}
        >
          {item.productNameSnapshot}
        </p>
        <div className="mt-0.5 flex flex-row items-baseline justify-between gap-2">
          <p
            className="m-0 p-0"
            style={{
              color: 'var(--color-text)',
              fontSize: 'var(--font-size-md)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 'var(--fw-extrabold)',
              lineHeight: 1.55,
            }}
          >
            {item.roundPrice.toLocaleString()}원
          </p>
          <LowStock item={item} isPast={isPast} />
        </div>
        <CardDiscount item={item} />
        <DogamLabel productId={item.productId} />
        <CardMeta item={item} isPast={isPast} showLowStock={false} />
      </Link>
      <div style={overlayStyle(ratio)}>
        <CardWishButton productId={item.productId} roundId={round.id} name={item.productNameSnapshot} />
      </div>
      {quickAdd && (
        // 사진 영역 위에 + 버튼을 겹친다(링크 안에 버튼을 넣지 않기 위해 형제로 둔다). §3.1: 그림자 없는 흰 원.
        <div style={overlayStyle(ratio)}>
          <button
            type="button"
            aria-label={`${item.productNameSnapshot} 장바구니에 담기`}
            onClick={() => quickAdd(item)}
            style={{
              alignItems: 'center',
              background: 'transparent',
              border: 0,
              bottom: 2,
              cursor: 'pointer',
              display: 'flex',
              height: 'var(--touch-target)',
              justifyContent: 'center',
              padding: 0,
              pointerEvents: 'auto',
              position: 'absolute',
              right: 2,
              width: 'var(--touch-target)',
            }}
          >
            <span
              aria-hidden
              style={{
                alignItems: 'center',
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-full)',
                color: 'var(--color-primary-dark)',
                display: 'flex',
                fontSize: 22,
                fontWeight: 'var(--fw-extrabold)',
                height: 34,
                justifyContent: 'center',
                lineHeight: 1,
                width: 34,
              }}
            >
              +
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** 그리드 아래 한 줄: 작은 그림 · "품절 · 상품명 · 가격" · "다음 회차에 다시 올라와요". */
function UnavailableRow({
  item,
  round,
  label,
}: {
  item: SaleRoundItem;
  round: PublicSaleRound;
  label: string;
}) {
  return (
    <li>
      <Link
        href={roundItemHref(item, round)}
        className="flex min-h-11 flex-row items-center gap-3"
        style={{ color: 'inherit', textDecoration: 'none' }}
      >
        <span
          className="relative shrink-0 overflow-hidden"
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-tag)',
            background: 'var(--color-surface-muted)',
            opacity: 0.6,
          }}
        >
          <ResilientImage
            fill
            src={item.productImageUrlSnapshot ?? PRODUCT_IMAGE_FALLBACK}
            fallbackSrc={PRODUCT_IMAGE_FALLBACK}
            alt=""
            sizes="44px"
            style={{ objectFit: 'cover' }}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className="truncate"
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-size-sm)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.45,
            }}
          >
            <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}>{label}</span>
            {' · '}
            {item.productNameSnapshot}
            {' · '}
            {item.roundPrice.toLocaleString()}원
          </span>
          <span
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-size-sm)',
              lineHeight: 1.45,
            }}
          >
            다음 회차에 다시 올라와요
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function RoundTileGrid({
  items,
  round,
  isPast = false,
  tileLabel,
  onQuickAdd,
}: {
  items: SaleRoundItem[];
  round: PublicSaleRound;
  isPast?: boolean;
  /** 타일 링크의 접근 이름. 없으면 링크 안 글자로 읽는다. */
  tileLabel?: (item: SaleRoundItem) => string | undefined;
  onQuickAdd?: (item: SaleRoundItem) => void;
}) {
  const gridItems: SaleRoundItem[] = [];
  const unavailable: Array<{ item: SaleRoundItem; label: string }> = [];
  for (const item of items) {
    const label = unavailableLabel(item, round, isPast);
    if (label) unavailable.push({ item, label });
    else gridItems.push(item);
  }

  return (
    <>
      {gridItems.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5">
          {gridItems.map((item, index) => (
            <RoundTile
              key={item.id}
              item={item}
              round={round}
              isPast={isPast}
              feature={isFeatureTile(index)}
              ariaLabel={tileLabel?.(item)}
              onQuickAdd={onQuickAdd}
            />
          ))}
        </div>
      )}
      {unavailable.length > 0 && (
        <ul
          className={`m-0 flex list-none flex-col gap-2 p-0 ${gridItems.length > 0 ? 'mt-6' : ''}`}
        >
          {unavailable.map(({ item, label }) => (
            <UnavailableRow key={item.id} item={item} round={round} label={label} />
          ))}
        </ul>
      )}
    </>
  );
}
