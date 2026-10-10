'use client';

import type { Order, Product } from '@greenhub/shared';
import { Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { DashboardCard } from '@/components/DashboardCard';
import { buildTodayTasks } from './today-tasks';

/**
 * 홈 최상단 "오늘 할 일" 체크리스트.
 * 각 줄은 건수 > 0일 때만 렌더, 전부 0이면 완료 메시지(줄 계산은 today-tasks.ts).
 * 모든 항목은 홈이 이미 로드하는 데이터로 계산 — 신규 API 없음.
 * 상품 집계는 신뢰 가능할 때만 사용한다. 상품 조회 실패·로딩 중에는
 * 비활성 상품 0건으로 오인하지 않고 경고로 분리한다.
 */
export function TodayTasksCard({
  orders,
  products,
  productsError,
  productsTrustworthy,
  openIssueCount = 0,
}: {
  orders: Order[];
  products: Product[];
  productsError: string | null;
  productsTrustworthy: boolean;
  /** 가게 전체 열린 운영 기록 수(환불·결제·연락·사진 확인 필요). */
  openIssueCount?: number;
}) {
  const inactiveCount = productsTrustworthy ? products.filter((p) => !p.isActive).length : 0;
  const tasks = buildTodayTasks({ orders, openIssueCount, inactiveCount });

  const showProductWarning = !productsTrustworthy;

  return (
    <DashboardCard title="오늘 할 일">
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
          오늘 할 일을 모두 마쳤어요
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
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: t.dot,
                  flexShrink: 0,
                }}
              />
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
