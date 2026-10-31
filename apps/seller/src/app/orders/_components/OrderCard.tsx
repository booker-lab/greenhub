'use client';

import type { Order } from '@greenhub/shared';
import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import {
  ACCENT_BORDER,
  DELIVERY_LABEL,
  formatRelativeTime,
  STATUS_COLOR,
  STATUS_LABEL,
} from '../_constants';
import { displayBuyerName, summarizeOrderProducts } from '../[id]/_lib';

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius md = 8px, shadow xs)·Group·Text(p, 여백 0, 줄 높이 1.55)와 같은 값.
// Mantine Button size="sm"(높이 36)은 @greenhub/ui Button 기본 크기다. 안쪽 Paper(픽업 코드)는 그림자를 따로 주지 않아도
// 바깥 Paper의 --paper-shadow를 물려받아 같은 그림자(xs)가 진다.
const TEXT = 'm-0 p-0 text-base';
const CLAMP1 = 'line-clamp-1 text-ellipsis';
const PAPER = 'block rounded-[8px] bg-white';

// Mantine Badge light color(STATUS_COLOR) → @greenhub/ui Badge 변형.
const LIGHT_BADGE: Record<
  string,
  'light' | 'destructive' | 'warning' | 'light-dark' | 'secondary'
> = {
  brand: 'light',
  red: 'destructive',
  yellow: 'warning',
  dark: 'light-dark',
  gray: 'secondary',
};

// 검색·필터로 목록이 다시 계산돼도 같은 주문 객체의 카드는 다시 그리지 않는다.
export const OrderCard = memo(function OrderCard({ order }: { order: Order }) {
  const router = useRouter();

  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED';
  const productSummary = summarizeOrderProducts(order);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 외형 유지 교체(UI 교체 P4) — Mantine Paper 카드 클릭 동작을 그대로 옮긴다. 키보드는 카드 안 버튼·상세 링크로 간다.
    // biome-ignore lint/a11y/noStaticElementInteractions: 위와 같다.
    <div
      className={`${PAPER} p-4 shadow-mantine-xs`}
      style={{ cursor: 'pointer', borderLeft: `4px solid ${ACCENT_BORDER[order.status]}` }}
      onClick={() => router.push(`/orders/${order.id}`)}
    >
      {/* 상단: 상태 뱃지 + 시간 */}
      <div className="mb-2.5 flex flex-row flex-wrap items-center justify-between gap-4">
        <Badge variant={LIGHT_BADGE[STATUS_COLOR[order.status]]} className="rounded-[32px]">
          {STATUS_LABEL[order.status]}
        </Badge>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {formatRelativeTime(order.createdAt)}
        </p>
      </div>

      {/* 주문 정보 */}
      <p
        className={`${TEXT} mb-0.5`}
        style={{
          fontWeight: 'var(--fw-bold)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text)',
        }}
      >
        주문 {order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`}
      </p>
      {productSummary && (
        <p
          className={`${TEXT} ${CLAMP1} mb-1`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {productSummary}
        </p>
      )}
      {/* 손님 이름 — 상세와 같은 표시 규칙. 전화는 카드에 싣지 않고 검색에만 쓴다. */}
      <p
        className={`${TEXT} ${CLAMP1} mb-1`}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        주문자 {displayBuyerName(order)}
      </p>
      <p
        className={`${TEXT} mb-1.5`}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
      >
        {DELIVERY_LABEL[order.deliveryMethod]}
        {order.requestedDeliveryDate && ` · ${order.requestedDeliveryDate}`}
      </p>
      <p
        className={`${TEXT} mb-3`}
        style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
        }}
      >
        {order.totalAmount.toLocaleString()}원
      </p>

      {/* 액션 버튼 — 준비 시작은 상세 페이지에서 수행 */}
      {canPrepare && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: 카드 클릭이 버튼 클릭과 겹치지 않게 막는 상자다(Mantine Group 그대로).
        // biome-ignore lint/a11y/noStaticElementInteractions: 위와 같다.
        <div
          className="flex flex-row flex-wrap items-center justify-start gap-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            onClick={() => router.push(`/orders/${order.id}`)}
            className="flex-1 rounded-[8px]"
          >
            준비 시작
          </Button>
        </div>
      )}

      {order.status === 'RECRUITING' && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: 카드 클릭을 막는 안내 상자다(Mantine Alert 그대로).
        // biome-ignore lint/a11y/noStaticElementInteractions: 위와 같다.
        <Alert
          variant="secondary"
          className="mt-2.5 rounded-[8px] py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <AlertDescription>
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
            >
              공동구매 모집 중
            </p>
            <p
              className={`${TEXT} mt-0.5`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              모집 마감 후 인원 충족 시 자동 확정됩니다.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {order.status === 'HUB_ARRIVED' && order.pickupCode && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: 카드 클릭을 막는 픽업 코드 상자다(Mantine Paper 그대로).
        // biome-ignore lint/a11y/noStaticElementInteractions: 위와 같다.
        <div
          className={`${PAPER} mt-2.5 p-3 text-center shadow-mantine-xs`}
          style={{ background: 'var(--color-primary-surface)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p
            className={`${TEXT} mb-1`}
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-primary-dark)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            픽업 코드
          </p>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-2xl)',
              letterSpacing: '0.2em',
              fontFamily: 'monospace',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-primary-dark)',
            }}
          >
            {order.pickupCode}
          </p>
        </div>
      )}
    </div>
  );
});
