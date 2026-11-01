'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useHomeCardContext } from '@/components/HomeProductList';
import ProductTopBar from '@/components/ProductTopBar';
import { useProducts } from '@/hooks/useProducts';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';

// ① 외형 유지(UI 교체 P5): Mantine Container sm(720px, 안쪽 0, 아래 100)·Stack(gap lg 20·xs 10)·Title h1(줄 높이 1.3)·
// Text(p, 크기 지정 없으면 md·줄 높이 1.55, sm은 줄 높이 1.45)·Box(md 16)와 같은 값.
const CONTAINER = 'mx-auto max-w-[720px] pb-[100px]';
const TITLE = 'm-0 text-[22px] leading-[1.3] font-extrabold';
const TEXT = 'm-0 p-0 leading-[1.55]';
const SMALL_TEXT = 'm-0 p-0 leading-[1.45]';
const MEDIUM = { fontSize: 'var(--font-size-md)' } as const;
const SMALL = { fontSize: 'var(--font-size-sm)' } as const;

// 품질 보장 모아보기(quality-guarantee, 벤치마킹 비교 기능). 보장 조건과 이번 회차 보장 상품.
export default function GuaranteePage() {
  if (!isFeatureOn('quality-guarantee')) notFound();
  return <GuaranteeContent />;
}

function GuaranteeContent() {
  const { products } = useProducts();
  const storeId = products[0]?.storeId ?? null;
  const card = useHomeCardContext(storeId, products);
  const guarantee = card.storeProfile?.guarantee;
  const { currentRound } = useSaleRounds(storeId);
  const items =
    currentRound?.items.filter(
      (item) => item.status !== 'HIDDEN' && card.productsById.get(item.productId)?.guaranteed,
    ) ?? [];

  return (
    <div className={CONTAINER}>
      <ProductTopBar />
      <div
        className="flex flex-col gap-5 px-4"
        style={{ paddingTop: 'calc(68px + env(safe-area-inset-top))' }}
      >
        <h1 className={TITLE}>{guarantee?.enabled ? guarantee.title : '품질 보장'}</h1>
        {guarantee?.enabled ? (
          <div
            className="p-4"
            style={{ background: 'var(--color-primary-surface)', borderRadius: 'var(--radius)' }}
          >
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {guarantee.terms.map((term) => (
                <li key={term} style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.7 }}>
                  {term}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={SMALL_TEXT} style={{ ...SMALL, color: 'var(--color-text-secondary)' }}>
            지금은 품질 보장을 운영하지 않아요.
          </p>
        )}
        <div>
          <p className={`${TEXT} mb-3`} style={{ ...MEDIUM, fontWeight: 800 }}>
            이번 회차 보장 상품 {items.length}
          </p>
          <div className="flex flex-col gap-2.5">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(item.roundId)}`}
                className="p-4"
                style={{
                  border: 'var(--border)',
                  borderRadius: 'var(--radius)',
                  color: 'inherit',
                  display: 'flex',
                  justifyContent: 'space-between',
                  textDecoration: 'none',
                }}
              >
                <p className={SMALL_TEXT} style={{ ...SMALL, fontWeight: 700 }}>
                  {item.productNameSnapshot}
                </p>
                <p className={SMALL_TEXT} style={{ ...SMALL, fontWeight: 800 }}>
                  {item.roundPrice.toLocaleString()}원
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
