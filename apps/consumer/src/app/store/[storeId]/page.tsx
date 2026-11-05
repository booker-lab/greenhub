'use client';

import { Button } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useState } from 'react';
import { BenchmarkCardProvider, CardDiscount, CardMeta } from '@/components/benchmark/CardExtras';
import { useHomeCardContext } from '@/components/HomeProductList';
import ProductTopBar from '@/components/ProductTopBar';
import { useProducts } from '@/hooks/useProducts';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';

// ① 외형 유지(UI 교체 P5): Mantine Container sm(720px, 안쪽 0, 아래 100)·Stack(gap lg 20)·Title h1(줄 높이 1.3)·
// Text(p, 크기 지정 없으면 md·줄 높이 1.55, sm은 줄 높이 1.45)·Box(md 16·sm 12)·SimpleGrid(2열, 12)·Button outline과 같은 값.
const TITLE = 'm-0 text-[22px] leading-[1.3] font-extrabold';
const TEXT = 'm-0 p-0 leading-[1.55]';
const SMALL_TEXT = 'm-0 p-0 leading-[1.45]';
const MEDIUM = { fontSize: 'var(--font-size-md)' } as const;
const SMALL = { fontSize: 'var(--font-size-sm)' } as const;

// 판매자 화면(seller-store, 벤치마킹 비교 기능): 소개·재배 이야기·별점 요약·이번 회차 상품·공유.
export default function StorePage() {
  if (!isFeatureOn('seller-store')) notFound();
  return <StoreContent />;
}

function StoreContent() {
  const params = useParams<{ storeId: string }>();
  const storeId = typeof params.storeId === 'string' ? params.storeId : null;
  const { products } = useProducts();
  const storeProducts = products.filter((p) => p.storeId === storeId);
  const card = useHomeCardContext(storeId, storeProducts);
  const profile = card.storeProfile;
  const { currentRound } = useSaleRounds(storeId);
  const [shared, setShared] = useState<string | null>(null);

  const reviewValues = Object.values(card.reviewStats);
  const reviewCount = reviewValues.reduce((sum, r) => sum + r.count, 0);
  const reviewAverage =
    reviewCount > 0
      ? Math.round(
          (reviewValues.reduce((sum, r) => sum + r.average * r.count, 0) / reviewCount) * 10,
        ) / 10
      : 0;
  const items = currentRound?.items.filter((item) => item.status !== 'HIDDEN') ?? [];

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: profile?.name ?? '그린러브', url });
      else {
        await navigator.clipboard.writeText(url);
        setShared('주소를 복사했어요');
      }
    } catch {
      // 공유 창을 닫으면 아무것도 하지 않는다.
    }
  }

  return (
    <div className="mx-auto max-w-[720px] pb-[100px]">
      <ProductTopBar />
      <div
        className="flex flex-col gap-5 px-4"
        style={{ paddingTop: 'calc(68px + env(safe-area-inset-top))' }}
      >
        <div>
          <p
            className={SMALL_TEXT}
            style={{ ...SMALL, fontWeight: 800, color: 'var(--color-primary-dark)' }}
          >
            {[profile?.region, profile?.sinceYear ? `${profile.sinceYear}년부터` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h1 className={TITLE}>{profile?.name ?? '판매자'}</h1>
          {profile?.intro && (
            <p className={`${TEXT} mt-1`} style={MEDIUM}>
              {profile.intro}
            </p>
          )}
          {isFeatureOn('reviews') && reviewCount > 0 && (
            <p className={`${SMALL_TEXT} mt-1.5`} style={{ ...SMALL, fontWeight: 700 }}>
              <span aria-hidden style={{ color: '#F5A524' }}>
                ★
              </span>{' '}
              {reviewAverage.toFixed(1)} · 후기 {reviewCount}
            </p>
          )}
          <Button variant="outline" className="mt-3" onClick={() => void share()}>
            판매자 공유하기
          </Button>
          {shared && (
            <p
              role="status"
              className={`${SMALL_TEXT} mt-1`}
              style={{ ...SMALL, color: 'var(--color-primary-dark)' }}
            >
              {shared}
            </p>
          )}
        </div>

        {profile?.story && (
          <div
            className="p-4"
            style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
          >
            <p className={`${TEXT} mb-1.5`} style={{ ...MEDIUM, fontWeight: 800 }}>
              어떻게 고르나요
            </p>
            <p className={SMALL_TEXT} style={{ ...SMALL, whiteSpace: 'pre-line' }}>
              {profile.story}
            </p>
          </div>
        )}

        <div>
          <p className={`${TEXT} mb-3`} style={{ ...MEDIUM, fontWeight: 800 }}>
            {currentRound ? `${currentRound.name} 상품` : '이번 회차 상품'}
          </p>
          {items.length === 0 ? (
            <p className={SMALL_TEXT} style={{ ...SMALL, color: 'var(--color-text-secondary)' }}>
              지금 열린 회차 상품이 없어요.
            </p>
          ) : (
            <BenchmarkCardProvider value={card}>
              <div className="grid grid-cols-2 gap-3">
                {items.map((item) => (
                  <Link
                    key={item.id}
                    href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(item.roundId)}`}
                    className="p-3"
                    style={{
                      border: 'var(--border)',
                      borderRadius: 'var(--radius)',
                      color: 'inherit',
                      textDecoration: 'none',
                    }}
                  >
                    <p
                      className={`${SMALL_TEXT} line-clamp-2 text-ellipsis`}
                      style={{ ...SMALL, fontWeight: 700 }}
                    >
                      {item.productNameSnapshot}
                    </p>
                    <p className={`${TEXT} mt-0.5`} style={{ ...MEDIUM, fontWeight: 800 }}>
                      {item.roundPrice.toLocaleString()}원
                      <CardDiscount item={item} />
                    </p>
                    <CardMeta item={item} isPast={false} />
                  </Link>
                ))}
              </div>
            </BenchmarkCardProvider>
          )}
        </div>
      </div>
    </div>
  );
}
