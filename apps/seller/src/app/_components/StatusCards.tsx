'use client';

import type { Product } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { ChevronRight, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import type { OrderGroup } from '@/app/orders/_constants';
import type { Summary } from '@/app/settlements/_constants';
import { DashboardCard } from '@/components/DashboardCard';
import type { DashboardSummaryData } from '@/hooks/useDashboardSummary.recovery';
import {
  resolveDashboardSummaryAmountText,
  resolveDashboardSummaryView,
} from '@/hooks/useDashboardSummary.recovery';

// ① 외형 유지(UI 교체 P4): Mantine Text·Group·Stack·UnstyledButton·Button과 같은 값을 Tailwind로 그린다.
// Group은 가로 flex(줄바꿈, 가운데 정렬), Stack은 세로 flex(늘임)이고 gap xs는 10px, lg는 20px이다.
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

// ─── 주문 처리 현황 카드 ──────────────────────────────────────────

interface PipelineStep {
  group: OrderGroup;
  label: string;
  href: string;
}

const PIPELINE: PipelineStep[] = [
  { group: 'ACTION_REQUIRED', label: '처리 필요', href: '/orders?tab=ACTION_REQUIRED' },
  { group: 'WAITING', label: '대기 중', href: '/orders?tab=WAITING' },
  { group: 'IN_DELIVERY', label: '배송 중', href: '/orders?tab=IN_DELIVERY' },
  { group: 'DONE', label: '완료', href: '/orders?tab=DONE' },
];

/** 건수가 null이면 아직 받지 못했거나 받지 못한 것이다 — 0건으로 속이지 않고 '—'로 보인다. */
export function OrderStatusCard({
  groupCounts,
}: {
  groupCounts: Record<OrderGroup, number | null>;
}) {
  return (
    <DashboardCard title="주문 처리 현황" moreHref="/orders">
      <div className="flex flex-row flex-nowrap items-start justify-start gap-0.5">
        {PIPELINE.map((step, i) => {
          const count = groupCounts[step.group];
          return (
            <Fragment key={step.group}>
              {i > 0 && (
                <ChevronRight
                  size={14}
                  color="var(--color-text-disabled)"
                  style={{ flexShrink: 0, marginTop: 8 }}
                />
              )}
              <Link href={step.href} className={UNSTYLED_BUTTON} style={{ flex: 1, minWidth: 0 }}>
                <div className="flex flex-col items-center justify-start gap-0.5">
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-2xl)',
                      fontWeight: 'var(--fw-bold)',
                      lineHeight: 1,
                      color: 'var(--color-text)',
                    }}
                  >
                    {count ?? '—'}
                  </p>
                  <p
                    className={TEXT}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-disabled)',
                      textAlign: 'center',
                    }}
                  >
                    {step.label}
                  </p>
                </div>
              </Link>
            </Fragment>
          );
        })}
      </div>
      <p
        className={TEXT}
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-disabled)',
          marginTop: 10,
        }}
      >
        취소 {groupCounts.CANCELLED ?? '—'}건
      </p>
    </DashboardCard>
  );
}

// ─── 정산 현황 카드 ──────────────────────────────────────────────
// 정산 조회 실패를 정상 0원으로 표시하지 않는다.
// 첫 실패는 "—" + 오류 + retry, stale은 이전 금액 + 갱신 실패 표시.

export function SettlementCard({
  summary,
  loading,
  error,
  hasLoaded,
  onRetry,
}: {
  summary: Summary | null;
  loading: boolean;
  error: string | null;
  hasLoaded?: boolean;
  onRetry?: () => void;
}) {
  const effectiveHasLoaded = hasLoaded ?? (summary !== null);
  const view = resolveDashboardSummaryView({
    hasLoaded: effectiveHasLoaded,
    loading,
    error,
  });
  const amountText = resolveDashboardSummaryAmountText({
    summary: summary as unknown as DashboardSummaryData | null,
    view,
  });

  if (view === 'LOADING') {
    return (
      <DashboardCard title="정산 현황" moreHref="/settlements">
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          불러오는 중…
        </p>
      </DashboardCard>
    );
  }

  if (view === 'READ_FAILED') {
    return (
      <DashboardCard title="정산 현황" moreHref="/settlements">
        <div className="flex flex-col items-stretch justify-start gap-2.5">
          <div className="flex flex-row flex-wrap items-center justify-between gap-4">
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              오늘 정산 예정
            </p>
            <p
              className={TEXT}
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text-disabled)',
              }}
            >
              —
            </p>
          </div>
          <p
            className={TEXT}
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {error ?? '정산 정보를 불러오지 못했습니다.'}
          </p>
          {onRetry && (
            <Button size="xs" variant="light-destructive" onClick={onRetry} className="self-start">
              <RefreshCcw className="size-3.5" data-icon="inline-start" />
              다시 조회
            </Button>
          )}
        </div>
      </DashboardCard>
    );
  }

  const isStale = view === 'STALE';
  return (
    <DashboardCard title="정산 현황" moreHref="/settlements">
      <div className="flex flex-row flex-wrap items-center justify-between gap-4">
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          오늘 정산 예정
        </p>
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text)',
          }}
        >
          {amountText}
        </p>
      </div>
      {isStale && (
        <div className="mt-2.5 flex flex-col items-stretch justify-start gap-2.5">
          <p
            className={TEXT}
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            최신 정보를 확인하지 못했습니다. 이전 정보입니다.
          </p>
          {onRetry && (
            <Button size="xs" variant="light-warning" onClick={onRetry} className="self-start">
              <RefreshCcw className="size-3.5" data-icon="inline-start" />
              다시 조회
            </Button>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

// ─── 상품 현황 카드 ──────────────────────────────────────────────
// 상품 조회 실패·로딩 중을 정상 0건으로 표시하지 않는다.
// 첫 실패는 counts 대신 오류 + retry, stale은 이전 수치 + 갱신 실패 표시.

export function ProductStatusCard({
  products,
  loading,
  error,
  hasLoaded,
  onRetry,
}: {
  products: Product[];
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  onRetry?: () => void;
}) {
  if (!hasLoaded && loading) {
    return (
      <DashboardCard title="상품 현황" moreHref="/products">
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          불러오는 중…
        </p>
      </DashboardCard>
    );
  }

  if (error && !hasLoaded) {
    return (
      <DashboardCard title="상품 현황" moreHref="/products">
        <div className="flex flex-col items-stretch justify-start gap-2.5">
          <p
            className={TEXT}
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            상품 정보를 불러오지 못했습니다.
          </p>
          {onRetry && (
            <Button size="xs" variant="light-destructive" onClick={onRetry} className="self-start">
              <RefreshCcw className="size-3.5" data-icon="inline-start" />
              다시 조회
            </Button>
          )}
        </div>
      </DashboardCard>
    );
  }

  const activeCount = products.filter((p) => p.isActive).length;
  const inactiveCount = products.length - activeCount;
  const isStale = hasLoaded && error !== null;
  return (
    <DashboardCard title="상품 현황" moreHref="/products">
      <div className="flex flex-row flex-wrap items-center justify-start gap-5">
        <div className="flex flex-row flex-wrap items-center justify-start gap-1.5">
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            판매 중
          </p>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}
          >
            {activeCount}
          </p>
        </div>
        <p className={TEXT} style={{ color: 'var(--color-text-disabled)' }}>
          ·
        </p>
        <div className="flex flex-row flex-wrap items-center justify-start gap-1.5">
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            비활성
          </p>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-text)',
            }}
          >
            {inactiveCount}
          </p>
        </div>
      </div>
      {isStale && (
        <div className="mt-2.5 flex flex-col items-stretch justify-start gap-2.5">
          <p
            className={TEXT}
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            최신 정보를 확인하지 못했습니다. 이전 수치입니다.
          </p>
          {onRetry && (
            <Button size="xs" variant="light-warning" onClick={onRetry} className="self-start">
              <RefreshCcw className="size-3.5" data-icon="inline-start" />
              다시 조회
            </Button>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
