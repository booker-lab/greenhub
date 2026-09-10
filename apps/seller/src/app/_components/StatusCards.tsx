'use client';

import type { Product } from '@greenhub/shared';
import { Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
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

export function OrderStatusCard({ groupCounts }: { groupCounts: Record<OrderGroup, number> }) {
  return (
    <DashboardCard title="주문 처리 현황" moreHref="/orders">
      <Group gap={2} align="flex-start" wrap="nowrap">
        {PIPELINE.map((step, i) => {
          const count = groupCounts[step.group];
          const accent = step.group === 'ACTION_REQUIRED' && count > 0;
          return (
            <Fragment key={step.group}>
              {i > 0 && (
                <ChevronRight
                  size={14}
                  color="var(--color-text-disabled)"
                  style={{ flexShrink: 0, marginTop: 8 }}
                />
              )}
              <UnstyledButton component={Link} href={step.href} style={{ flex: 1, minWidth: 0 }}>
                <Stack gap={2} align="center">
                  <Text
                    style={{
                      fontSize: 'var(--font-size-2xl)',
                      fontWeight: 'var(--fw-bold)',
                      lineHeight: 1,
                      color: accent ? 'var(--color-danger)' : 'var(--color-text)',
                    }}
                  >
                    {count}
                  </Text>
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-disabled)',
                      textAlign: 'center',
                    }}
                  >
                    {step.label}
                  </Text>
                </Stack>
              </UnstyledButton>
            </Fragment>
          );
        })}
      </Group>
      <Text
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-disabled)',
          marginTop: 10,
        }}
      >
        취소 {groupCounts.CANCELLED}건
      </Text>
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
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          불러오는 중…
        </Text>
      </DashboardCard>
    );
  }

  if (view === 'READ_FAILED') {
    return (
      <DashboardCard title="정산 현황" moreHref="/settlements">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              오늘 정산 예정
            </Text>
            <Text
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text-disabled)',
              }}
            >
              —
            </Text>
          </Group>
          <Text
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {error ?? '정산 정보를 불러오지 못했습니다.'}
          </Text>
          {onRetry && (
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<RefreshCcw size={14} />}
              onClick={onRetry}
              style={{ alignSelf: 'flex-start' }}
            >
              다시 조회
            </Button>
          )}
        </Stack>
      </DashboardCard>
    );
  }

  const isStale = view === 'STALE';
  return (
    <DashboardCard title="정산 현황" moreHref="/settlements">
      <Group justify="space-between">
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          오늘 정산 예정
        </Text>
        <Text
          style={{
            fontSize: 'var(--font-size-md)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-primary)',
          }}
        >
          {amountText}
        </Text>
      </Group>
      {isStale && (
        <Stack gap="xs" mt="xs">
          <Text
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            최신 정보를 확인하지 못했습니다. 이전 정보입니다.
          </Text>
          {onRetry && (
            <Button
              size="xs"
              variant="light"
              color="yellow"
              leftSection={<RefreshCcw size={14} />}
              onClick={onRetry}
              style={{ alignSelf: 'flex-start' }}
            >
              다시 조회
            </Button>
          )}
        </Stack>
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
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
          불러오는 중…
        </Text>
      </DashboardCard>
    );
  }

  if (error && !hasLoaded) {
    return (
      <DashboardCard title="상품 현황" moreHref="/products">
        <Stack gap="xs">
          <Text
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            상품 정보를 불러오지 못했습니다.
          </Text>
          {onRetry && (
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<RefreshCcw size={14} />}
              onClick={onRetry}
              style={{ alignSelf: 'flex-start' }}
            >
              다시 조회
            </Button>
          )}
        </Stack>
      </DashboardCard>
    );
  }

  const activeCount = products.filter((p) => p.isActive).length;
  const inactiveCount = products.length - activeCount;
  const isStale = hasLoaded && error !== null;
  return (
    <DashboardCard title="상품 현황" moreHref="/products">
      <Group gap="lg">
        <Group gap={6}>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            판매 중
          </Text>
          <Text style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}>
            {activeCount}
          </Text>
        </Group>
        <Text style={{ color: 'var(--color-text-disabled)' }}>·</Text>
        <Group gap={6}>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            비활성
          </Text>
          <Text
            style={{
              fontSize: 'var(--font-size-md)',
              fontWeight: 'var(--fw-bold)',
              color: inactiveCount > 0 ? 'var(--color-danger)' : 'var(--color-text)',
            }}
          >
            {inactiveCount}
          </Text>
        </Group>
      </Group>
      {isStale && (
        <Stack gap="xs" mt="xs">
          <Text
            role="alert"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            최신 정보를 확인하지 못했습니다. 이전 수치입니다.
          </Text>
          {onRetry && (
            <Button
              size="xs"
              variant="light"
              color="yellow"
              leftSection={<RefreshCcw size={14} />}
              onClick={onRetry}
              style={{ alignSelf: 'flex-start' }}
            >
              다시 조회
            </Button>
          )}
        </Stack>
      )}
    </DashboardCard>
  );
}
