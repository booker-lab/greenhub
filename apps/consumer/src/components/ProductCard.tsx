'use client';

import { Progress } from '@greenhub/ui/components/progress';
import Link from 'next/link';
import { getGroupBuyStatus, type Product } from '@greenhub/shared';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';

interface ProductCardProps {
  product: Product;
}

const categoryLabels: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
};

// ① 외형 유지(UI 교체 P5): Mantine Card(component=Link, radius 16, 흰 면·검정 글자, 위치 relative, outline 0이라
// 초점 링 없음)·Box p xs(10)·Progress sm(높이 5)·radius xl(32)·위 6과 같은 값.
const CARD_LINK =
  'relative block overflow-hidden rounded-[16px] bg-white text-black no-underline outline-none touch-manipulation [-webkit-tap-highlight-color:transparent]';

export default function ProductCard({ product }: ProductCardProps) {
  const imgSrc = product.images?.[0] ?? PRODUCT_IMAGE_FALLBACK;

  return (
    <Link
      href={`/products/${product.id}`}
      className={CARD_LINK}
      style={{
        overflow: 'hidden',
        display: 'block',
        textDecoration: 'none',
        border: 'var(--border)',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '4/5',
          background: 'var(--color-border)',
          overflow: 'hidden',
        }}
      >
        <ResilientImage
          fill
          src={imgSrc}
          fallbackSrc={PRODUCT_IMAGE_FALLBACK}
          alt={product.name}
          sizes="(max-width: 600px) 50vw, 33vw"
          style={{ objectFit: 'cover' }}
        />
      </div>

      <div className="p-2.5">
        <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 8px',
            }}
          >
            {categoryLabels[product.category] ?? product.category}
          </span>
          {product.saleType === 'group' && (
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-primary-dark)',
                background: 'var(--color-primary-surface)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
              }}
            >
              공동구매
            </span>
          )}
        </div>
        <p
          style={{
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text)',
            margin: 0,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {product.name}
        </p>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text-secondary)',
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          {product.price.toLocaleString()}원
        </p>
        {(() => {
          const colors = product.selection?.colors ?? product.colors ?? [];
          return colors.length > 0 ? (
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-disabled)',
                marginTop: 4,
                marginBottom: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {colors.slice(0, 3).join(' · ')}
              {colors.length > 3 && ` +${colors.length - 3}`}
            </p>
          ) : null;
        })()}
        {product.saleType === 'group' &&
          product.groupSummary &&
          (() => {
            const { currentQuantity, targetQuantity } = product.groupSummary;
            const pct = Math.min((currentQuantity / targetQuantity) * 100, 100);
            const status = getGroupBuyStatus(product.groupSummary);
            const done = status !== 'open';
            const statusLabel =
              status === 'full'
                ? '모집 완료'
                : status === 'expired'
                  ? '모집 마감'
                  : status === 'unavailable'
                    ? '판매 준비 중'
                    : `${currentQuantity}/${targetQuantity}개 모집 중`;
            return (
              <>
                {/* 지금 화면과 같게 구간은 늘 주색이다. 교체 전 코드가 준 --progress-color는 Mantine이 읽지 않는
                    변수(구간 색은 --progress-section-color)라 마감·완료여도 회색이 되지 않았다. */}
                <Progress value={pct} className="mt-1.5 h-[5px] rounded-[32px]" />
                <p
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: done ? 'var(--color-text-disabled)' : 'var(--color-primary-dark)',
                    marginTop: 2,
                    marginBottom: 0,
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  {statusLabel}
                </p>
              </>
            );
          })()}
      </div>
    </Link>
  );
}
