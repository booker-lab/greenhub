'use client';

import type { Product } from '@greenhub/shared';
import { Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import type { OrderGroup } from '@/app/orders/_constants';
import type { Summary } from '@/app/settlements/_constants';
import { DashboardCard } from '@/components/DashboardCard';

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

export function SettlementCard({
  summary,
  loading,
  error,
}: {
  summary: Summary | null;
  loading: boolean;
  error: string | null;
}) {
  const amount = summary?.totalNetAmount ?? 0;
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
            color: error ? 'var(--color-text-disabled)' : 'var(--color-primary)',
          }}
        >
          {loading ? '불러오는 중…' : error ? '—' : `${amount.toLocaleString('ko-KR')}원`}
        </Text>
      </Group>
    </DashboardCard>
  );
}

// ─── 상품 현황 카드 ──────────────────────────────────────────────

export function ProductStatusCard({ products }: { products: Product[] }) {
  const activeCount = products.filter((p) => p.isActive).length;
  const inactiveCount = products.length - activeCount;
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
    </DashboardCard>
  );
}
