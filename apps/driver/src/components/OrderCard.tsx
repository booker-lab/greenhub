import type { Order } from '@greenhub/shared';
import { Badge } from '@greenhub/ui/components/badge';
import { Card } from '@greenhub/ui/components/card';
import { cn } from '@greenhub/ui/lib/utils';
import Link from 'next/link';
import { getRedeliveryPaymentPresentation } from '@/app/board/_lib/redelivery-payment';
import { type DriverOrderItem, orderItemLines, orderItemsLabel } from '@/lib/order-quantity';
import { type BadgeColor, badgeTone, card, text } from './look';

const METHOD_BADGE: Record<string, { label: string; color: BadgeColor }> = {
  direct: { label: '직배송', color: 'brand' },
  hub: { label: '거점 픽업', color: 'gray' },
  parcel: { label: '택배', color: 'gray' },
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

export default function OrderCard({
  order,
  tab,
}: {
  order: Order & { items?: DriverOrderItem[] };
  tab: string;
}) {
  const badge = METHOD_BADGE[order.deliveryMethod] ?? METHOD_BADGE.direct;
  const payment = getRedeliveryPaymentPresentation(order.redeliveryPayment);
  const itemLines = orderItemLines(order.items);
  const displayAddress =
    order.deliveryMethod === 'hub' ? (order.hubAddress ?? '-') : (order.address ?? '-');
  const displayLocation =
    order.deliveryMethod === 'hub'
      ? `${order.hubName ?? '거점'} · ${displayAddress}`
      : displayAddress;

  return (
    <Link
      href={`/board/${order.id}`}
      // 상세는 화면에서 주문을 다시 조회하므로 카드마다 미리 받아 proxy 인증 확인을 늘리지 않는다.
      prefetch={false}
      data-testid={`driver-order-${order.id}`}
      className="block text-inherit no-underline"
    >
      <Card className={card}>
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge className={badgeTone[`${badge.color}-light`]}>{badge.label}</Badge>
              {order.status === 'DELIVERY_HELD' && (
                <Badge className={badgeTone['red-light']}>배송 보류</Badge>
              )}
              {payment && (
                <Badge className={badgeTone[`${payment.color}-light`]}>{payment.label}</Badge>
              )}
            </div>
            <p
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {tab === 'preparing'
                ? `수거 ${formatTime(order.preparedAt)}`
                : `배송 시작 ${formatTime(order.updatedAt)}`}
            </p>
          </div>
          <p
            className={text}
            style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}
          >
            {order.buyerName ?? '소비자'}
          </p>
          <p
            className={cn(text, 'truncate')}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {displayLocation}
          </p>
          {itemLines
            ? itemLines.map((line, index) => (
                <p
                  // biome-ignore lint/suspicious/noArrayIndexKey: 주문 상품 줄은 응답 순서 그대로 고정 — reorder 없음
                  key={index}
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {line}
                </p>
              ))
            : order.productName && (
                <p
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {orderItemsLabel(order.productName, order.quantity)}
                </p>
              )}
          {payment && (
            <p
              className={text}
              style={{
                fontSize: 'var(--font-size-sm)',
                color:
                  payment.color === 'brand'
                    ? 'var(--color-primary-dark)'
                    : payment.color === 'red'
                      ? 'var(--color-danger)'
                      : 'var(--color-status-warning-text)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              {payment.description}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}
