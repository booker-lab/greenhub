import type { Order } from '@greenhub/shared';
import { cn } from '@greenhub/ui/lib/utils';
import Link from 'next/link';
import { getRedeliveryPaymentPresentation } from '@/app/board/_lib/redelivery-payment';
import { splitDeliveryAddress } from '@/lib/address-parts';
import { formatDeliveryDayLabel } from '@/lib/delivery-day';
import {
  type DriverOrderItem,
  orderItemLines,
  orderItemsLabel,
  orderItemsSummary,
} from '@/lib/order-quantity';
import { isDamagedHold, type PickupPlace, readPickupPlace } from '@/lib/pickup-place';
import { text } from './look';
import { PendingPhotoBadge, usePendingPhotoBadge } from './pending-photo-notice';

// 기사 ② 방향(design-direction.md §6 "한 손 배송 목록"): 틀은 흰 바탕·검정 글자이고 색은 문제 상태(빨강)에만 쓴다.
// 배송 중 탭의 첫 배송지는 동·호수를 크게 쓴 "다음 배송지"(variant="next"), 나머지는 두 줄 행(variant="row")이다.

export type DriverListOrder = Order & {
  items?: DriverOrderItem[];
  deliveryAddress?: { address?: string } | null;
  /** 요청한 기사 본인에게 배정된 주문인지. 이전 API 응답에는 없다. */
  assignedToMe?: boolean;
  /** 회차 주문의 회차 배송 시작 시각(ISO). 회차가 없는 주문에는 없다. */
  deliveryDate?: string | null;
  /** 수거 대기·상품 파손 보류 주문의 가게 이름·주소. 다른 상태와 이전 API 응답에는 없다. */
  pickupStoreName?: string;
  pickupAddress?: string;
  /** 보류 주문의 보류 사유 코드(목록 응답). 다른 상태와 이전 API 응답에는 없다. */
  deliveryHoldReasonCode?: string;
};

/** 한 번에 수거 고르기 칸. 있으면 행은 주문 상세로 가는 링크 대신 고르기 칸이 된다. */
export type OrderRowSelection = {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** 고를 수 없는 까닭 등 행 아래 짧은 안내. */
  note?: string | null;
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
// 한국어 글이 낱말 중간에서 줄을 바꾸지 않게 한다(R-09·3차 재감사 S-06). 긴 주소·낱말만 아무 데서나 끊는다.
const keepWords = { wordBreak: 'keep-all', overflowWrap: 'anywhere' } as const;
// 받는 분 이름이 없을 때 쓰는 말. 기사 앱 글은 모두 "손님"이다(3차 재감사 S-12).
const BUYER_FALLBACK = '손님';

export default function OrderCard({
  order,
  tab,
  variant = 'row',
  selection,
}: {
  order: DriverListOrder;
  tab: string;
  variant?: 'next' | 'row';
  selection?: OrderRowSelection;
}) {
  const payment = getRedeliveryPaymentPresentation(order.redeliveryPayment);
  // 배송 중 주문의 완료 사진이 이 기기 대기열에 있으면 행에 상태 배지를 붙인다(Y3).
  const pendingPhotoKind = usePendingPhotoBadge(order.id);
  const pendingPhoto =
    order.status === 'DELIVERING' && pendingPhotoKind ? (
      <PendingPhotoBadge kind={pendingPhotoKind} />
    ) : null;
  const itemLines = orderItemLines(order.items);
  const isHub = order.deliveryMethod === 'hub';
  const isHeld = order.status === 'DELIVERY_HELD';
  // 상품 파손 보류는 다시 배송하지 않고 가게로 돌려준다. 다른 보류와 구분해 행에 밝힌다(S-11).
  const damagedHold = isDamagedHold(order);
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
  // 오늘(서울 날짜)이 아닌 회차 주문에만 배송일을 쓴다. 목록은 날짜와 관계없이 보이는 주문을 모두 보여 준다.
  const deliveryDayText = formatDeliveryDayLabel(order.deliveryDate, new Date());
  const paymentLine = payment && (
    <p
      className={text}
      style={{
        ...muted,
        ...keepWords,
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
          <p className={text} style={{ ...muted, ...keepWords }}>
            다음 배송지{deliveryDayText ? ` · ${deliveryDayText}` : ''}
            {methodText ? ` · ${methodText}` : ''}
            {parts.detail ? ` · ${parts.base}` : ''}
          </p>
          <h2
            className="m-0"
            style={{
              fontSize: parts.detail ? 28 : 'var(--font-size-xl)',
              fontWeight: 'var(--fw-extrabold)',
              lineHeight: 1.3,
              ...keepWords,
            }}
          >
            {parts.detail ?? parts.base}
          </h2>
          {pendingPhoto}
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
          받는 분 {order.buyerName ?? BUYER_FALLBACK}
        </p>
        {paymentLine && <div className="mt-1">{paymentLine}</div>}
      </Link>
    );
  }

  // 행은 세 줄이다: 1줄 주소, 2줄 배송일·받는 분, 3줄 상품 요약(+ 수거 대기 탭의 수거 시각).
  // 한 줄에 이어 붙이면 390px에서 상품 뒤쪽과 수거 시각이 늘 잘려, 수거 시각은 줄어들지 않는 칸에 따로 둔다.
  const rowItemsText = orderItemsSummary(order.items) ?? itemsText;
  const pickupTimeText = tab === 'preparing' ? `수거 ${formatTime(order.preparedAt)}` : null;
  const buyerLine = [methodText, order.buyerName ?? BUYER_FALLBACK].filter(Boolean).join(' · ');

  const rowBody = (
    <>
      <p
        className={cn(text, 'truncate')}
        style={{ fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}
      >
        {parts.detail ? `${parts.detail} · ${parts.base}` : parts.base}
      </p>
      {pendingPhoto}
      <p className={cn(text, 'truncate')} style={muted}>
        {isHeld && (
          <span style={{ color: 'var(--color-danger)', fontWeight: 'var(--fw-bold)' }}>
            <span
              aria-hidden="true"
              className="mr-1.5 inline-block size-2 rounded-full align-middle"
              style={{ backgroundColor: 'var(--color-danger)' }}
            />
            {damagedHold ? '상품 파손 · 가게로 반납' : '배송 보류'}
          </span>
        )}
        {isHeld && ' · '}
        {deliveryDayText && (
          <span style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}>
            {deliveryDayText} 배송
          </span>
        )}
        {deliveryDayText && ' · '}
        {buyerLine}
      </p>
      {(rowItemsText || pickupTimeText) && (
        <p className={cn(text, 'flex min-w-0 gap-1')} style={muted}>
          {rowItemsText && <span className="min-w-0 truncate">{rowItemsText}</span>}
          {pickupTimeText && (
            <span className="shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {rowItemsText ? '· ' : ''}
              {pickupTimeText}
            </span>
          )}
        </p>
      )}
      {paymentLine}
    </>
  );

  // 수거 장소 줄은 수거 대기 행 아래에 붙인다. 지도 링크는 행 링크·고르기 칸 밖에 둔다(링크 안에 링크를 두지 않는다).
  const pickup = tab === 'preparing' ? readPickupPlace(order) : null;
  const rowPadding = pickup ? 'pt-3 pb-1' : 'py-3';
  const row = selection ? (
    // 한 번에 수거 고르기: 행 전체가 고르기 칸의 이름표이고 상세로 가지 않는다.
    <label
      data-testid={`driver-order-${order.id}`}
      className={cn(
        'flex min-h-16 items-center gap-3',
        rowPadding,
        selection.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
      style={{ color: 'var(--color-text)' }}
    >
      <input
        type="checkbox"
        className="size-6 shrink-0"
        style={{ accentColor: 'var(--color-text)' }}
        checked={selection.checked}
        disabled={selection.disabled}
        onChange={selection.onToggle}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        {rowBody}
        {selection.note && (
          <p className={text} style={muted}>
            {selection.note}
          </p>
        )}
      </div>
    </label>
  ) : (
    <Link
      href={`/board/${order.id}`}
      prefetch={false}
      data-testid={`driver-order-${order.id}`}
      className={cn(
        'flex min-h-16 flex-col justify-center gap-0.5 text-inherit no-underline',
        rowPadding,
      )}
      style={{ color: 'var(--color-text)' }}
    >
      {rowBody}
    </Link>
  );

  if (!pickup) return row;
  return (
    <div className="flex flex-col pb-3">
      {row}
      <PickupLine orderId={order.id} pickup={pickup} indent={Boolean(selection)} />
    </div>
  );
}

/** 수거 대기 행의 "수거: 가게 이름 · 주소"와 카카오맵 주소 보기 링크(주소가 있을 때만). */
function PickupLine({
  orderId,
  pickup,
  indent,
}: {
  orderId: string;
  pickup: PickupPlace;
  indent: boolean;
}) {
  return (
    <div
      data-testid={`driver-order-pickup-${orderId}`}
      className={cn('flex items-center gap-3', indent && 'pl-9')}
    >
      <p className={cn(text, 'min-w-0 flex-1 truncate')} style={muted}>
        {pickup.label}
      </p>
      {pickup.mapHref && (
        <a
          href={pickup.mapHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="카카오맵에서 수거지 보기"
          className="inline-flex min-h-11 shrink-0 items-center underline underline-offset-4"
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--color-text)',
          }}
        >
          지도
        </a>
      )}
    </div>
  );
}
