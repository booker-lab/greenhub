'use client';

import { formatKoreanMonthDayKST, type Order } from '@greenhub/shared';
import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { DELIVERY_LABEL, formatRelativeTime, STATUS_LABEL, STATUS_TONE } from '../_constants';
import { displayBuyerName, summarizeOrderProducts } from '../[id]/_lib';

// ② 디자인 방향(D2·2026-11-01 결정): 카드는 그림자·왼쪽 상태 띠 없이 틀 위 흰 면이고, 상태는 점 + 글자(StatusDot)다.
// 나머지(radius md = 8px·Group·Text·Button 기본 크기 36)는 ① 값을 유지한다.
const TEXT = 'm-0 p-0 text-base';
const PAPER = 'block rounded-[8px] bg-card';

// 검색·필터로 목록이 다시 계산돼도 같은 주문 객체의 카드는 다시 그리지 않는다.
export const OrderCard = memo(function OrderCard({ order }: { order: Order }) {
  const router = useRouter();

  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED';
  const productSummary = summarizeOrderProducts(order);
  const detailHref = `/orders/${order.id}`;
  // 수량: 주문 전체 수량. 상품이 여러 종이면 "총"을 붙인다. 숫자가 아니면 그리지 않는다.
  const multipleProducts = Array.isArray(order.orderItems) && order.orderItems.length > 1;
  const quantityText =
    typeof order.quantity === 'number' && Number.isFinite(order.quantity)
      ? `${multipleProducts ? '총 ' : ''}${order.quantity.toLocaleString()}개`
      : null;
  // 주문자 · 배송 수단 · 배송일("9월 29일"). 값이 없는 조각은 빼서 빈 구분자를 남기지 않는다.
  const metaLine = [
    `주문자 ${displayBuyerName(order)}`,
    DELIVERY_LABEL[order.deliveryMethod],
    formatKoreanMonthDayKST(order.requestedDeliveryDate),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 외형 유지 교체(UI 교체 P4) — Mantine Paper 카드 클릭 동작을 그대로 옮긴다. 키보드는 카드 안 버튼·상세 링크로 간다.
    // biome-ignore lint/a11y/noStaticElementInteractions: 위와 같다.
    <div
      className={`${PAPER} p-4`}
      style={{ cursor: 'pointer' }}
      onClick={() => router.push(detailHref)}
    >
      {/* 상단: 상태(점 + 글자) + 시간 */}
      <div className="mb-2.5 flex flex-row flex-wrap items-center justify-between gap-4">
        <StatusDot tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</StatusDot>
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {formatRelativeTime(order.createdAt)}
        </p>
      </div>

      {/* 주문 정보 — 판매자가 챙길 것은 상품과 수량이다(design-direction §5). 주문번호는 보조 줄로 내린다. */}
      {/* 이름은 말줄임 없이 낱말 단위로 줄을 바꾸고, 띄어쓰기 없는 긴 이름은 카드 밖으로 넘치지 않게 끊는다. */}
      <div className="mb-0.5 flex flex-row flex-nowrap items-start justify-between gap-3">
        {/* 키보드·화면 낭독기로 카드를 여는 링크. 카드 클릭과 겹쳐 두 번 이동하지 않게 전파를 막는다. */}
        <Link
          href={detailHref}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 rounded-[6px] text-base font-bold break-keep no-underline outline-none [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          style={{ color: 'var(--color-text)' }}
        >
          {productSummary ?? '상품'}
        </Link>
        {quantityText && (
          <p
            className={`${TEXT} shrink-0 whitespace-nowrap`}
            style={{
              fontWeight: 'var(--fw-bold)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-text)',
            }}
          >
            {quantityText}
          </p>
        )}
      </div>
      {/* 손님 이름은 상세와 같은 표시 규칙. 전화는 카드에 싣지 않고 검색에만 쓴다. */}
      <p
        className={`${TEXT} mb-0.5 break-keep [overflow-wrap:anywhere]`}
        style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
      >
        {metaLine}
      </p>
      <p
        className={`${TEXT} mb-1.5`}
        style={{
          fontSize: 'var(--font-size-sm)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--color-text-secondary)',
        }}
      >
        주문 {order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`}
      </p>
      <div className="flex flex-row flex-nowrap items-center justify-between gap-3">
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--fw-bold)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--color-text)',
          }}
        >
          {order.totalAmount.toLocaleString()}원
        </p>
        {/* 행 단위 행동은 초록 면 대신 검정 밑줄 글자다(design-direction §5). 준비 시작은 상세 화면에서 한다. */}
        {canPrepare && (
          <Link
            href={detailHref}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-[6px] text-sm font-bold whitespace-nowrap underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            style={{ color: 'var(--color-text)' }}
          >
            준비 시작
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>

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
              style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
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
              fontWeight: 'var(--fw-bold)',
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
