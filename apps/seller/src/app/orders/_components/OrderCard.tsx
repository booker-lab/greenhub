'use client';

import type { Order } from '@greenhub/shared';
import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { DELIVERY_LABEL, formatRelativeTime, STATUS_LABEL, STATUS_TONE } from '../_constants';
import { displayBuyerName, summarizeOrderProducts } from '../[id]/_lib';

// ② 디자인 방향(D2·2026-11-01 결정): 카드는 그림자·왼쪽 상태 띠 없이 틀 위 흰 면이고, 상태는 점 + 글자(StatusDot)다.
// 나머지(radius md = 8px·Group·Text·Button 기본 크기 36)는 ① 값을 유지한다.
const TEXT = 'm-0 p-0 text-base';
const CLAMP1 = 'line-clamp-1 text-ellipsis';
const PAPER = 'block rounded-[8px] bg-white';

// 검색·필터로 목록이 다시 계산돼도 같은 주문 객체의 카드는 다시 그리지 않는다.
export const OrderCard = memo(function OrderCard({ order }: { order: Order }) {
  const router = useRouter();

  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED';
  const productSummary = summarizeOrderProducts(order);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 외형 유지 교체(UI 교체 P4) — Mantine Paper 카드 클릭 동작을 그대로 옮긴다. 키보드는 카드 안 버튼·상세 링크로 간다.
    // biome-ignore lint/a11y/noStaticElementInteractions: 위와 같다.
    <div
      className={`${PAPER} p-4`}
      style={{ cursor: 'pointer' }}
      onClick={() => router.push(`/orders/${order.id}`)}
    >
      {/* 상단: 상태(점 + 글자) + 시간 */}
      <div className="mb-2.5 flex flex-row flex-wrap items-center justify-between gap-4">
        <StatusDot tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</StatusDot>
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
          className={`${PAPER} mt-2.5 p-3 text-center`}
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
