'use client';

import type { Order, Product } from '@greenhub/shared';
import { Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { STATUS_GROUP_MAP } from '@/app/orders/_constants';
import { DashboardCard } from '@/components/DashboardCard';
import { isDelayed } from '@/lib/prep';

interface TaskRow {
  key: string;
  icon: string;
  label: string;
  href: string;
}

/**
 * 홈 최상단 "오늘 할 일" 체크리스트.
 * 각 줄은 건수 > 0일 때만 렌더, 전부 0이면 완료 메시지.
 * 모든 항목은 홈이 이미 로드하는 데이터로 계산 — 신규 API 없음.
 * 상품 집계는 신뢰 가능할 때만 사용한다. 상품 조회 실패·로딩 중에는
 * 비활성 상품 0건으로 오인하지 않고 경고로 분리한다.
 */
export function TodayTasksCard({
  orders,
  products,
  productsError,
  productsTrustworthy,
}: {
  orders: Order[];
  products: Product[];
  productsError: string | null;
  productsTrustworthy: boolean;
}) {
  const newOrderCount = orders.filter(
    (o) => STATUS_GROUP_MAP[o.status] === 'ACTION_REQUIRED',
  ).length;
  const delayedCount = orders.filter((o) => isDelayed(o)).length;
  const inactiveCount = productsTrustworthy ? products.filter((p) => !p.isActive).length : 0;

  const tasks: TaskRow[] = [];
  if (newOrderCount > 0)
    tasks.push({
      key: 'new',
      icon: '🔴',
      label: `신규 주문 ${newOrderCount}건 처리하기`,
      href: '/orders?tab=ACTION_REQUIRED',
    });
  if (delayedCount > 0)
    tasks.push({
      key: 'delayed',
      icon: '🔴',
      label: `발송 지연 ${delayedCount}건 확인`,
      href: '/prep',
    });
  if (productsTrustworthy && inactiveCount > 0)
    tasks.push({
      key: 'inactive',
      icon: '⚠️',
      label: `비활성 상품 ${inactiveCount}건 점검`,
      href: '/products',
    });

  const showProductWarning = !productsTrustworthy;

  return (
    <DashboardCard title="☀️ 오늘 할 일">
      {showProductWarning && (
        <Text
          role={productsError ? 'alert' : 'status'}
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-disabled)',
            marginBottom: tasks.length === 0 ? 0 : 8,
          }}
        >
          {productsError
            ? '상품 정보를 불러오지 못했습니다. 비활성 상품 점검을 건너뜁니다.'
            : '상품 상태 확인 중… 비활성 상품 점검을 잠시 건너뜁니다.'}
        </Text>
      )}
      {tasks.length === 0 && productsTrustworthy ? (
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          오늘 할 일을 모두 마쳤어요 🎉
        </Text>
      ) : tasks.length === 0 && !productsTrustworthy ? (
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          주문 할 일은 없습니다.
        </Text>
      ) : (
        <Stack gap={0}>
          {tasks.map((t, i) => (
            <UnstyledButton
              key={t.key}
              component={Link}
              href={t.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 0',
                borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
              }}
            >
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>{t.icon}</Text>
              <Text
                style={{
                  flex: 1,
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text)',
                  fontWeight: 'var(--fw-medium)',
                }}
              >
                {t.label}
              </Text>
              <ChevronRight size={16} color="var(--color-text-disabled)" />
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </DashboardCard>
  );
}
