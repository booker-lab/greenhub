import type { Order } from '@greenhub/shared';
import { cn } from '@greenhub/ui/lib/utils';
import Link from 'next/link';
import { getRedeliveryPaymentPresentation } from '@/app/board/_lib/redelivery-payment';
import { splitDeliveryAddress } from '@/lib/address-parts';
import { type DriverOrderItem, orderItemLines, orderItemsLabel } from '@/lib/order-quantity';
import { text } from './look';

// 기사 ② 방향(design-direction.md §6 "한 손 배송 목록"): 틀은 흰 바탕·검정 글자이고 색은 문제 상태(빨강)에만 쓴다.
// 배송 중 탭의 첫 배송지는 동·호수를 크게 쓴 "다음 배송지"(variant="next"), 나머지는 두 줄 행(variant="row")이다.

type DriverListOrder = Order & {
  items?: DriverOrderItem[];
  deliveryAddress?: { address?: string } | null;
};

function formatTime(value?: string | null) {
  if (!value) return '시간 미정';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 미정';
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const itemStyle = {
  fontSize: 'var(--font-size-xl)',
  fontWeight: 'var(--fw-bold)',
  lineHeight: 1.4,
  fontVariantNumeric: 'tabular-nums',
} as const;

const muted = { fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' } as const;

export default function OrderCard({
  order,
  tab,
  variant = 'row',
}: {
  order: DriverListOrder;
  tab: string;
  variant?: 'next' | 'row';
}) {
  const payment = getRedeliveryPaymentPresentation(order.redeliveryPayment);
  const itemLines = orderItemLines(order.items);
  const isHub = order.deliveryMethod === 'hub';
  const isHeld = order.status === 'DELIVERY_HELD';
  // 거점은 거점 이름이 주인공이고 주소가 보조다. 직배송은 동·호수(상세 주소)가 주인공이다.
  const parts = isHub
    ? { base: order.hubAddress ?? '-', detail: order.hubName ?? '거점' }
    : (splitDeliveryAddress(order.address, order.deliveryAddress?.address) ?? {
        base: '-',
        detail: null,
      });
  const itemsText = itemLines
    ? itemLines.join(', ')
    : order.productName
      ? orderItemsLabel(order.productName, order.quantity)
      : null;
  const methodText = isHub ? '거점 픽업' : order.deliveryMethod === 'parcel' ? '택배' : null;
  const paymentLine = payment && (
    <p
      className={text}
      style={{
        ...muted,
        color: payment.color === 'red' ? 'var(--color-danger)' : 'var(--driver-text-muted)',
        fontWeight: payment.color === 'red' ? 'var(--fw-bold)' : 'var(--fw-regular)',
      }}
    >
      {payment.label} · {payment.description}
    </p>
  );

  if (variant === 'next') {
    return (
      <Link
        href={`/board/${order.id}`}
        // 상세는 화면에서 주문을 다시 조회하므로 카드마다 미리 받아 proxy 인증 확인을 늘리지 않는다.
        prefetch={false}
        data-testid={`driver-order-${order.id}`}
        className="block rounded-[var(--radius)] p-4 text-inherit no-underline"
        style={{ backgroundColor: 'var(--color-surface-muted)', color: 'var(--color-text)' }}
      >
        <div className="flex flex-col gap-1">
          <p className={text} style={muted}>
            다음 배송지{methodText ? ` · ${methodText}` : ''}
            {parts.detail ? ` · ${parts.base}` : ''}
          </p>
          <h2
            className="m-0"
            style={{
              fontSize: parts.detail ? 28 : 'var(--font-size-xl)',
              fontWeight: 'var(--fw-extrabold)',
              lineHeight: 1.3,
              wordBreak: 'keep-all',
            }}
          >
            {parts.detail ?? parts.base}
          </h2>
        </div>
        {/* 건넬 상품을 크게: 상품마다 한 줄(20px 굵게). */}
        <div className="mt-3 flex flex-col">
          {itemLines
            ? itemLines.map((line, index) => (
                <p
                  // biome-ignore lint/suspicious/noArrayIndexKey: 주문 상품 줄은 응답 순서 그대로 고정 — reorder 없음
                  key={index}
                  className={text}
                  style={itemStyle}
                >
                  {line}
                </p>
              ))
            : itemsText && (
                <p className={text} style={itemStyle}>
                  {itemsText}
                </p>
              )}
        </div>
        <p className={cn(text, 'mt-1')} style={muted}>
          받는 분 {order.buyerName ?? '소비자'}
        </p>
        {paymentLine && <div className="mt-1">{paymentLine}</div>}
      </Link>
    );
  }

  const second = [
    order.buyerName ?? '소비자',
    itemsText,
    tab === 'preparing' ? `수거 ${formatTime(order.preparedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      href={`/board/${order.id}`}
      prefetch={false}
      data-testid={`driver-order-${order.id}`}
      className="flex min-h-16 flex-col justify-center gap-0.5 py-3 text-inherit no-underline"
      style={{ color: 'var(--color-text)' }}
    >
      <p
        className={cn(text, 'truncate')}
        style={{ fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}
      >
        {parts.detail ? `${parts.detail} · ${parts.base}` : parts.base}
      </p>
      <p className={cn(text, 'truncate')} style={muted}>
        {isHeld && (
          <span style={{ color: 'var(--color-danger)', fontWeight: 'var(--fw-bold)' }}>
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block size-2 rounded-full align-middle"
              style={{ backgroundColor: 'var(--color-danger)' }}
            />
            배송 보류
          </span>
        )}
        {isHeld && ' · '}
        {methodText && `${methodText} · `}
        {second}
      </p>
      {paymentLine}
    </Link>
  );
}
