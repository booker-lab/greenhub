'use client';

import {
  LIGHT_LABELS,
  PLACEMENT_LABELS,
  PRODUCT_NOTICE_FIELDS,
  type Product,
  resolveProductNotice,
  type SaleRoundItem,
} from '@greenhub/shared';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { useProductReviews, useStoreProfile } from '@/hooks/useBenchmark';
import { useProducts } from '@/hooks/useProducts';
import type { PublicSaleRound } from '@/hooks/useSaleRounds';
import { sizeRows } from '@/lib/benchmark-format';
import { isFeatureOn } from '@/lib/features';
import { PUBLIC_BUSINESS_INFO } from '@/lib/publicBusinessInfo';
import { ReviewPhotoStrip } from './ReviewPhotos';

// 상품 상세의 벤치마킹 비교 기능 묶음(품질 보장·크기·관리 안내·판매자 소개·후기·비슷한 꽃).
// 각 칸은 기능 토글이 켜져 있고 보여줄 값이 있을 때만 그린다.
// 상품정보제공고시만은 법정 표시라 토글과 상관없이 항상 그린다.

const sectionTitle = {
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--fw-extrabold)',
  margin: 0,
} as const;

// ① 외형 유지(UI 교체 P5): Mantine Box·Stack·Text 계산값을 Tailwind로 옮겼다.
// Text = margin 0·굵기 400(fw 없을 때), size sm = 15px/1.45, size lg = 18px/1.6. 간격 xs 10·sm 12·md 16·lg 20.
// lineClamp는 Mantine처럼 -webkit-box·줄 수·말줄임이다.
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="pt-5" style={{ borderTop: 'var(--border)' }}>
      <h2 id={id} style={sectionTitle}>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            borderBottom: '1px solid var(--color-surface-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            paddingBottom: 6,
          }}
        >
          <p
            className="m-0 p-0 text-sm font-normal"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {label}
          </p>
          <p className="m-0 p-0 text-sm" style={{ fontWeight: 700 }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span
      role="img"
      aria-label={`별점 ${value.toFixed(1)}점`}
      style={{ color: '#F5A524', letterSpacing: 1 }}
    >
      {'★'.repeat(full)}
      <span style={{ color: 'var(--color-border)' }}>{'★'.repeat(5 - full)}</span>
    </span>
  );
}

export function ReviewsSection({ productId }: { productId: string }) {
  const reviews = useProductReviews(productId, isFeatureOn('reviews'));
  const [expanded, setExpanded] = useState(false);
  if (!isFeatureOn('reviews') || !reviews) return null;
  const shown = expanded ? reviews.items : reviews.items.slice(0, 3);
  return (
    <Section id="reviews-title" title={`후기 ${reviews.summary.count}`}>
      {reviews.summary.count === 0 ? (
        <p className="m-0 p-0 text-sm font-normal" style={{ color: 'var(--color-text-secondary)' }}>
          아직 후기가 없어요. 배송을 받은 뒤 MY 주문 내역에서 첫 후기를 남겨 주세요.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="m-0 p-0 text-lg" style={{ fontWeight: 800 }}>
            <Stars value={reviews.summary.average} /> {reviews.summary.average.toFixed(1)}
          </p>
          {shown.map((review) => (
            <div
              key={review.id}
              style={{ borderBottom: '1px solid var(--color-surface-muted)', paddingBottom: 12 }}
            >
              <p className="m-0 p-0 text-sm" style={{ fontWeight: 700 }}>
                <Stars value={review.rating} /> {review.authorName}
                <span
                  className="m-0 p-0 text-sm"
                  style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}
                >
                  {' '}
                  · {review.createdAt.slice(0, 10).replace(/-/g, '.')}
                </span>
              </p>
              <p className="m-0 mt-1 p-0 text-sm font-normal" style={{ whiteSpace: 'pre-line' }}>
                {review.text}
              </p>
              <ReviewPhotoStrip urls={review.photoUrls} label={`${review.authorName} 후기`} />
            </div>
          ))}
          {reviews.items.length > 3 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                background: 'var(--color-surface-muted)',
                border: 0,
                borderRadius: 'var(--radius-full)',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 700,
                minHeight: 'var(--touch-target)',
              }}
            >
              {expanded ? '접기' : `후기 ${reviews.items.length - 3}개 더 보기`}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

/** 상품정보제공고시("기타 재화"). 접힌 채로 그리고, 판매자가 비운 칸은 기본값으로 채운다. */
export function ProductNoticeSection({
  product,
  storeName,
}: {
  product: Product;
  storeName: string | null;
}) {
  const notice = resolveProductNotice(product.notice, {
    itemName: product.name,
    producer: storeName?.trim() || PUBLIC_BUSINESS_INFO.businessName,
    csPhone: PUBLIC_BUSINESS_INFO.phone,
  });
  return (
    <section aria-labelledby="notice-title" className="pt-5" style={{ borderTop: 'var(--border)' }}>
      <details>
        <summary style={{ cursor: 'pointer', minHeight: 'var(--touch-target)' }}>
          <h2 id="notice-title" style={{ ...sectionTitle, display: 'inline' }}>
            상품 정보 고시
          </h2>
        </summary>
        <div className="mt-3">
          <Rows rows={PRODUCT_NOTICE_FIELDS.map((field) => [field.label, notice[field.key]])} />
        </div>
      </details>
    </section>
  );
}

function Recommendations({ product, round }: { product: Product; round: PublicSaleRound }) {
  const { products } = useProducts();
  const byId = new Map<string, Product>(products.map((p: Product) => [p.id, p]));
  const sameCare = (other: Product | undefined) =>
    !!other &&
    ((product.light && other.light === product.light) ||
      (product.selection?.careLevel && other.selection?.careLevel === product.selection.careLevel));
  const candidates = round.items
    .filter((item) => item.productId !== product.id && item.status !== 'HIDDEN')
    .sort(
      (a, b) => Number(sameCare(byId.get(b.productId))) - Number(sameCare(byId.get(a.productId))),
    )
    .slice(0, 4);
  if (candidates.length === 0) return null;
  return (
    <Section id="recommend-title" title="이번 회차 비슷한 꽃">
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {candidates.map((item: SaleRoundItem) => (
          <Link
            key={item.id}
            href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`}
            style={{
              background: 'var(--color-surface-muted)',
              borderRadius: 'var(--radius-sm)',
              color: 'inherit',
              padding: 12,
              textDecoration: 'none',
            }}
          >
            <p className="m-0 line-clamp-2 p-0 text-sm text-ellipsis" style={{ fontWeight: 700 }}>
              {item.productNameSnapshot}
            </p>
            <p className="m-0 mt-0.5 p-0 text-sm" style={{ fontWeight: 800 }}>
              {item.roundPrice.toLocaleString()}원
            </p>
            {sameCare(byId.get(item.productId)) && (
              <p
                className="m-0 mt-0.5 p-0 text-sm"
                style={{ fontWeight: 700, color: 'var(--color-primary-dark)' }}
              >
                같은 관리 조건
              </p>
            )}
          </Link>
        ))}
      </div>
    </Section>
  );
}

export default function DetailExtras({
  product,
  round,
}: {
  product: Product;
  round: PublicSaleRound | null;
}) {
  // 고시의 생산자 칸이 비어 있으면 매장명을 쓰려고 토글과 상관없이 매장 소개를 읽는다.
  const store = useStoreProfile(
    product.storeId,
    isFeatureOn('seller-store') ||
      isFeatureOn('quality-guarantee') ||
      !product.notice?.producer?.trim(),
  );
  const guarantee =
    isFeatureOn('quality-guarantee') && product.guaranteed && store?.guarantee?.enabled
      ? store.guarantee
      : null;
  const size = isFeatureOn('size-info') ? sizeRows(product.size) : [];
  const placeRows: Array<[string, string]> = [];
  if (isFeatureOn('size-info') && product.light)
    placeRows.push(['빛', LIGHT_LABELS[product.light]]);
  if (isFeatureOn('size-info') && product.placements?.length) {
    placeRows.push(['어울리는 곳', product.placements.map((p) => PLACEMENT_LABELS[p]).join(', ')]);
  }
  const care = isFeatureOn('care-guide') ? product.careGuide : undefined;
  const producer =
    isFeatureOn('seller-store') && store && (store.intro || store.story) ? store : null;

  // 켜진 기능이 하나도 없어도 고시 칸은 항상 그리므로 묶음 전체를 숨기지 않는다.

  return (
    <div className="flex flex-col gap-5 px-4 pb-5">
      {guarantee && (
        <section
          aria-labelledby="guarantee-title"
          className="p-4"
          style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}
        >
          <h2 id="guarantee-title" style={{ ...sectionTitle, color: 'var(--color-primary-dark)' }}>
            {guarantee.title}
          </h2>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {guarantee.terms.map((term) => (
              <li key={term} style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                {term}
              </li>
            ))}
          </ul>
          <Link
            href="/guarantee"
            style={{
              color: 'var(--color-primary-dark)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 700,
            }}
          >
            보장 상품 모아보기 →
          </Link>
        </section>
      )}

      {(size.length > 0 || placeRows.length > 0) && (
        <Section id="size-title" title="크기와 어울리는 곳">
          <Rows rows={[...size, ...placeRows]} />
          <p
            className="m-0 mt-2 p-0 text-sm font-normal"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            경매에서 고른 같은 품종이라 실물 크기는 조금 다를 수 있어요.
          </p>
        </Section>
      )}

      {care && (
        <Section id="care-title" title="이렇게 키워 주세요">
          <div
            style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
          >
            {(
              [
                ['💧', '물 주기', care.watering],
                ['☀️', '빛', care.light],
                ['🌡️', '온도', care.temperature],
                ['🪴', '분갈이', care.repotting],
              ] as const
            ).map(([icon, label, text]) => (
              <div
                key={label}
                className="p-3"
                style={{
                  background: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <p className="m-0 p-0 text-sm" style={{ fontWeight: 800 }}>
                  <span aria-hidden>{icon}</span> {label}
                </p>
                <p
                  className="m-0 mt-1 p-0 text-sm font-normal"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {text}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {producer && (
        <Section id="producer-title" title="누가 골랐나요">
          <p className="m-0 p-0 text-sm" style={{ fontWeight: 800 }}>
            {producer.name}
            {producer.region ? ` · ${producer.region}` : ''}
            {producer.sinceYear ? ` · ${producer.sinceYear}년부터` : ''}
          </p>
          {producer.intro && <p className="m-0 mt-1 p-0 text-sm font-normal">{producer.intro}</p>}
          {producer.story && (
            <p
              className="m-0 mt-2 line-clamp-4 p-0 text-sm font-normal text-ellipsis"
              style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}
            >
              {producer.story}
            </p>
          )}
          <Link
            href={`/store/${encodeURIComponent(product.storeId)}`}
            style={{
              color: 'var(--color-primary-dark)',
              display: 'inline-block',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            판매자 화면 보기 →
          </Link>
        </Section>
      )}

      <ReviewsSection productId={product.id} />

      {isFeatureOn('recommendations') && round && (
        <Recommendations product={product} round={round} />
      )}

      <ProductNoticeSection product={product} storeName={store?.name ?? null} />
    </div>
  );
}
