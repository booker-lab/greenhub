'use client';

import type { GroupProductConfig, Order } from '@greenhub/shared';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import { DELIVERY_LABEL, STATUS_LABEL, STATUS_TONE } from '../../_constants';
import { formatDeadlineCountdown, resolveOrderItemLines, toDate } from '../_lib';
import { CustomerInfoSection } from './CustomerInfoSection';
import { OrderBenchmarkSection } from './OrderBenchmarkSection';
import { Row } from './OrderRow';

// ② 디자인 방향(D2·2026-11-01 결정): 카드는 그림자 없이 틀 위 흰 면, 상태는 점 + 글자(StatusDot).
// 나머지(radius lg = 16px·Group·Stack·Text)는 ① 값을 유지한다.
const TEXT = 'm-0 p-0 text-base font-normal';
const PAPER = 'block rounded-[16px] bg-white';

interface OrderInfoSectionProps {
  order: Order;
  productName: string | null;
  groupConfig: GroupProductConfig | null;
}

export function OrderInfoSection({ order, productName, groupConfig }: OrderInfoSectionProps) {
  const itemLines = resolveOrderItemLines(order);

  return (
    <>
      <div className={`${PAPER} p-4`}>
        <div className="mb-3 flex flex-row flex-wrap items-center justify-between gap-4">
          <StatusDot tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</StatusDot>
          <p
            className={TEXT}
            style={{
              fontSize: 'var(--font-size-sm)',
              color:
                order.status === 'RECRUITING'
                  ? 'var(--color-status-warning-text)'
                  : 'var(--color-text-disabled)',
              fontWeight: order.status === 'RECRUITING' ? 'var(--fw-medium)' : undefined,
            }}
          >
            {order.status === 'RECRUITING' && groupConfig
              ? formatDeadlineCountdown(groupConfig.recruitDeadline)
              : toDate(order.createdAt).toLocaleString('ko-KR', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
          </p>
        </div>
        <p className={TEXT} style={{ fontWeight: 'var(--fw-bold)' }}>
          주문 {order.orderNumber ?? `#${order.id.slice(-8).toUpperCase()}`}
        </p>
        <p
          className={`${TEXT} mt-0.5`}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
        >
          {order.saleType === 'group' ? '공동구매' : '일반 판매'}
        </p>
      </div>

      <div className={`${PAPER} p-4`}>
        <p
          className={`${TEXT} mb-2.5`}
          style={{
            fontWeight: 'var(--fw-medium)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          상품 정보
        </p>
        <div className="flex flex-col gap-1.5">
          {itemLines ? (
            <>
              {/* 포장할 상품 — 상품마다 한 줄씩 "상품명 × 수량" */}
              {itemLines.map((line) => (
                <div
                  key={line.key}
                  className="flex flex-row flex-nowrap items-start justify-between gap-2.5"
                >
                  <p
                    className={TEXT}
                    style={{
                      minWidth: 0,
                      wordBreak: 'break-word',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-medium)',
                      color: 'var(--color-text)',
                    }}
                  >
                    {line.productName} × {line.quantity}
                  </p>
                  {line.subtotalAmount !== null && (
                    <p
                      className={TEXT}
                      style={{
                        flexShrink: 0,
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      ₩{line.subtotalAmount.toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
              <Row label="총 수량" value={`${order.quantity}개`} />
            </>
          ) : (
            <>
              <Row label="상품명" value={productName ?? order.productId} />
              <Row label="수량" value={`${order.quantity}개`} />
            </>
          )}
          <Row
            label="상품 금액"
            value={`₩${(order.totalAmount - order.deliveryFee).toLocaleString()}`}
          />
          <Row label="배송비" value={`₩${order.deliveryFee.toLocaleString()}`} />
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 4 }}>
            <Row label="결제 금액" value={`₩${order.totalAmount.toLocaleString()}`} bold />
          </div>
        </div>
      </div>

      <OrderBenchmarkSection order={order} />

      {order.saleType === 'group' && groupConfig && (
        <div className={`${PAPER} p-4`}>
          <p
            className={`${TEXT} mb-2.5`}
            style={{
              fontWeight: 'var(--fw-medium)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            공동구매 현황
          </p>
          <div className="flex flex-col gap-1.5">
            <Row
              label="현재 수량"
              value={`${groupConfig.currentQuantity} / ${groupConfig.targetQuantity}개 (최소 ${groupConfig.minQuantity}개)`}
            />
            <Row
              label="모집 마감일"
              value={new Date(groupConfig.recruitDeadline).toLocaleDateString('ko-KR')}
            />
            <Row
              label="배송 예정일"
              value={new Date(groupConfig.groupDeliveryDate).toLocaleDateString('ko-KR')}
            />
          </div>
        </div>
      )}

      <CustomerInfoSection order={order} />

      <div className={`${PAPER} p-4`}>
        <p
          className={`${TEXT} mb-2.5`}
          style={{
            fontWeight: 'var(--fw-medium)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          배송 정보
        </p>
        <div className="flex flex-col gap-1.5">
          <Row label="배송 수단" value={DELIVERY_LABEL[order.deliveryMethod]} />
          {order.saleType === 'normal' && order.requestedDeliveryDate && (
            <Row
              label="희망 배송일"
              value={new Date(order.requestedDeliveryDate).toLocaleDateString('ko-KR')}
              highlight
            />
          )}
          {order.deliveryMethod !== 'hub' ? (
            <>
              <Row
                label="주소"
                value={`${order.deliveryAddress.address} ${order.deliveryAddress.addressDetail}`}
              />
              <Row label="우편번호" value={order.deliveryAddress.zipCode} />
              <Row label="서울·경기" value={order.isMetropolitan ? '해당' : '해당 없음'} />
            </>
          ) : (
            order.pickupCode && (
              <div
                className="mt-2.5 block rounded-[8px] bg-white p-3"
                style={{ backgroundColor: 'var(--color-primary-surface)', textAlign: 'center' }}
              >
                <p
                  className={`${TEXT} mb-1`}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  픽업 코드
                </p>
                <p
                  className={TEXT}
                  style={{
                    fontSize: 'var(--font-size-2xl)',
                    letterSpacing: '0.2em',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-primary-dark)',
                  }}
                >
                  {order.pickupCode}
                </p>
              </div>
            )
          )}
          {order.preparedAt && (
            <Row
              label="수거 예정 시각"
              value={new Date(order.preparedAt).toLocaleString('ko-KR', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              highlight
            />
          )}
        </div>
      </div>

      {order.status === 'CANCELLED' && order.cancelReason && (
        <div
          className="block rounded-[16px] bg-white p-4"
          style={{ backgroundColor: 'var(--color-danger-surface)' }}
        >
          <p
            className={`${TEXT} mb-2.5`}
            style={{
              fontWeight: 'var(--fw-medium)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-danger)',
            }}
          >
            취소 사유
          </p>
          <p
            className={TEXT}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
          >
            {order.cancelReason}
          </p>
        </div>
      )}
    </>
  );
}
