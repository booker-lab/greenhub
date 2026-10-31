'use client';

import { Button, ButtonLink } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo } from 'react';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import { readCreatedAtMillis, useOrders } from '@/hooks/useOrders';
import { isFeatureOn } from '@/lib/features';
import { collectPurchaseHistory } from '@/lib/purchase-history';

// 구매한 꽃(purchase-history, 벤치마킹 비교 기능). 내 주문 내역을 상품별로 모아 보여 준다.
// 기능이 꺼져 있으면 없는 화면이다.
export default function PurchaseHistoryPage() {
  if (!isFeatureOn('purchase-history')) notFound();
  return <PurchaseHistoryContent />;
}

const KST_DAY = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});
const KST_DAY_WITH_YEAR = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});
const KST_YEAR = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', timeZone: 'Asia/Seoul' });

function formatPurchaseDay(millis: number) {
  const date = new Date(millis);
  return KST_YEAR.format(date) === KST_YEAR.format(new Date())
    ? KST_DAY.format(date)
    : KST_DAY_WITH_YEAR.format(date);
}

// ① 외형 유지(UI 교체 P5): Mantine Container sm(720px, 좌우 md 16·위 lg 20·아래 100)·Title h1(줄 높이 1.3)·
// Text(p, 크기 prop이 없어 줄 높이 1.55, 글자 크기만 style로 바꿈)·Group·Stack(gap sm 12·md 16)·
// Button(radius xl, default xs = plain xs)과 같은 값.
const TITLE = 'm-0 text-[22px] leading-[1.3] font-extrabold';
const TEXT = 'm-0 p-0 leading-[1.55]';

const mutedTextStyle = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
} as const;

function PurchaseHistoryContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { orders, loading, error, refetch } = useOrders();
  const entries = useMemo(() => collectPurchaseHistory(orders, readCreatedAtMillis), [orders]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  if (status === 'loading' || !session) {
    return (
      <div className="py-[60px] text-center">
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-md)', color: 'var(--color-text-disabled)' }}
        >
          로딩 중...
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 pt-5 pb-[100px]">
      <h1 className={TITLE}>구매한 꽃</h1>
      <p className={`${TEXT} mt-1 mb-4`} style={mutedTextStyle}>
        지금까지 산 꽃을 최근에 산 순서로 모았어요. 취소·환불됐거나 결제가 끝나지 않은 주문은 빼요.
      </p>

      {loading && entries.length === 0 && (
        <p
          className={`${TEXT} py-5 text-center`}
          style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
        >
          불러오는 중...
        </p>
      )}

      {error && (
        <div className="mb-3 flex flex-row flex-wrap items-center justify-between gap-4">
          <p
            className={TEXT}
            style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}
          >
            주문 내역을 불러오지 못했습니다.
          </p>
          <Button variant="plain" size="xs" onClick={refetch}>
            다시 시도
          </Button>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-10">
          <p className={TEXT} style={mutedTextStyle}>
            아직 구매한 꽃이 없어요.
          </p>
          <ButtonLink render={<Link href="/" />}>이번 회차 보러 가기</ButtonLink>
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-col gap-3" data-testid="purchase-history-list">
          {entries.map((entry) => (
            <div
              key={entry.productId}
              className="flex flex-row flex-nowrap items-center justify-start gap-3 p-3"
              style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
            >
              <div
                style={{
                  position: 'relative',
                  width: 56,
                  height: 56,
                  flexShrink: 0,
                  overflow: 'hidden',
                  borderRadius: 12,
                  background: 'var(--color-surface-muted)',
                }}
              >
                <ResilientImage
                  fill
                  src={entry.productImageUrl ?? PRODUCT_IMAGE_FALLBACK}
                  fallbackSrc={PRODUCT_IMAGE_FALLBACK}
                  alt=""
                  sizes="56px"
                  style={{ objectFit: 'cover' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link
                  href={`/products/${encodeURIComponent(entry.productId)}`}
                  className={`${TEXT} line-clamp-1 text-ellipsis`}
                  style={{
                    color: 'var(--color-text)',
                    fontSize: 'var(--font-size-md)',
                    fontWeight: 'var(--fw-extrabold)',
                    textDecoration: 'none',
                  }}
                >
                  {entry.productName}
                </Link>
                <p className={`${TEXT} mt-0.5`} style={mutedTextStyle}>
                  {entry.lastPurchasedAt !== null
                    ? `마지막 구매 ${formatPurchaseDay(entry.lastPurchasedAt)} · `
                    : ''}
                  {entry.orderCount}번 주문
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
