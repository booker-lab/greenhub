'use client';

import { Badge } from '@greenhub/ui/components/badge';
import { Button } from '@greenhub/ui/components/button';
import type { AdminOrder } from '@/hooks/useAdmin';
import {
  cancellationBadge,
  formatOrderedAt,
  getAdminOrdersReadState,
  getStatusColor,
  isPostDeliveryRefundable,
  isRefundable,
  STATUS_LABEL,
  storeLabel,
} from '../_lib';

interface OrdersTableProps {
  orders: AdminOrder[];
  loading: boolean;
  /** useAdminOrders 조회 실패 메시지. null이면 마지막 조회가 실패하지 않았음. */
  error: string | null;
  /** 강제환불 처리 중인 주문 id 묶음 — 여러 건을 이어서 처리해도 각자 잠긴다. */
  processingIds: ReadonlySet<string>;
  /** 확인창을 띄울 대상 주문을 넘긴다(주문번호·금액 표시용). */
  onRefund: (order: AdminOrder) => void;
  /** 배송 완료 회차 주문의 배송 후 환불 확인창을 띄운다. 없으면 버튼을 숨긴다. */
  onPostDeliveryRefund?: (order: AdminOrder) => void;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. */
  onRetry: () => void;
}

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Paper(흰 면, shadow xs)·Group·Stack과 같은 값.
// 카드 목록·표는 Mantine hiddenFrom·visibleFrom sm(48em)과 같은 폭에서 바뀐다.
const TEXT = 'm-0 p-0 text-base';
const PAPER = 'block bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.1)]';
const GROUP = 'flex flex-row flex-wrap items-center';

// Mantine Badge color → @greenhub/ui Badge 변형(light·outline).
const LIGHT_BADGE = { red: 'destructive', brand: 'light', yellow: 'warning' } as const;
const OUTLINE_BADGE = { red: 'outline-destructive', yellow: 'outline-warning' } as const;

// 요청사항은 표 폭을 넓히지 않도록 주문번호 아래 작은 글씨로 최대 3줄만 보여준다.
export function RequestNote({ note }: { note?: string | null }) {
  const text = note?.trim();
  if (!text) return null;
  return (
    <p
      className={`${TEXT} line-clamp-3`}
      title={text}
      style={{
        fontSize: 'var(--font-size-xs)',
        color: 'var(--color-text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxWidth: 240,
      }}
    >
      요청: {text}
    </p>
  );
}

const metaText = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-secondary)',
};

// 상태 배지 + 취소 진행 배지(환불 진행 중·실패) — 표·카드 공용.
export function StatusBadges({ order }: { order: AdminOrder }) {
  const cancel = cancellationBadge(order.cancellationStatus);
  return (
    <div className={`${GROUP} justify-start gap-1`}>
      <Badge
        variant={LIGHT_BADGE[getStatusColor(order.status) as keyof typeof LIGHT_BADGE]}
        className="rounded-[32px]"
      >
        {STATUS_LABEL[order.status] ?? order.status}
      </Badge>
      {cancel && (
        <Badge
          variant={OUTLINE_BADGE[cancel.color as keyof typeof OUTLINE_BADGE]}
          className="rounded-[32px]"
        >
          {cancel.label}
        </Badge>
      )}
    </div>
  );
}

// 고객 이름 · 상품 요약 — 표·카드 공용. 고객 전화·주소는 목록에 싣지 않는다.
export function BuyerAndProduct({ order }: { order: AdminOrder }) {
  return (
    <p className={TEXT} style={metaText}>
      {order.buyerName?.trim() || '—'} · {order.productSummary?.trim() || '—'}
    </p>
  );
}

const thBase = {
  padding: '12px 16px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

export function OrdersTable({
  orders,
  loading,
  error,
  processingIds,
  onRefund,
  onPostDeliveryRefund,
  onRetry,
}: OrdersTableProps) {
  const readState = getAdminOrdersReadState({ loading, error, orders });

  if (readState === 'LOADING') {
    return (
      <p className={`${TEXT} py-20 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
        불러오는 중...
      </p>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "주문이 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <div
        className={`${PAPER} rounded-[16px]`}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <div className="flex flex-col items-center gap-3 px-4 py-16">
          <p className={TEXT} style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            주문 목록을 불러오지 못했습니다.
          </p>
          <p
            className={`${TEXT} text-center`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {error}
          </p>
          <Button onClick={onRetry} variant="outline" className="rounded-[8px]">
            다시 조회
          </Button>
        </div>
      </div>
    );
  }

  if (readState === 'EMPTY') {
    return (
      <div
        className={`${PAPER} rounded-[16px]`}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <p className={`${TEXT} py-16 text-center`} style={{ color: 'var(--color-text-disabled)' }}>
          주문이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* 모바일(<sm): 카드 리스트 — 마지막 컬럼(금액·강제환불) 잘림 방지 */}
      <ul className="m-0 flex list-none flex-col gap-3 p-0 min-[48em]:hidden" aria-label="주문 목록">
        {orders.map((order) => (
          <li
            key={order.id}
            className={`${PAPER} rounded-[8px] px-4 py-3`}
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div className={`${GROUP} mb-2.5 justify-between gap-4`}>
              <p
                className={`${TEXT} font-mono`}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                {order.orderNumber ?? `${order.id.slice(0, 12)}…`}
              </p>
              <StatusBadges order={order} />
            </div>
            <p className={`${TEXT} mb-0.5`} style={metaText}>
              {formatOrderedAt(order.createdAt)} · {storeLabel(order)}
            </p>
            <BuyerAndProduct order={order} />
            <RequestNote note={order.requestNote} />
            <div className={`${GROUP} mt-2.5 justify-between gap-4`}>
              <p className={TEXT} style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                ₩{order.totalAmount.toLocaleString()}
              </p>
              {isRefundable(order) && (
                <Button
                  onClick={() => onRefund(order)}
                  disabled={processingIds.has(order.id)}
                  size="xs"
                  variant="outline-destructive"
                  className="rounded-[8px]"
                >
                  {processingIds.has(order.id) ? '처리중…' : '강제환불'}
                </Button>
              )}
              {onPostDeliveryRefund && isPostDeliveryRefundable(order) && (
                <Button
                  onClick={() => onPostDeliveryRefund(order)}
                  disabled={processingIds.has(order.id)}
                  size="xs"
                  variant="outline-destructive"
                  className="rounded-[8px]"
                >
                  {processingIds.has(order.id) ? '처리중…' : '배송 후 환불'}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* 데스크톱(≥sm): 기존 테이블 유지(시각 회귀 0) */}
      <div
        className={`${PAPER} rounded-[16px] max-[47.99375em]:hidden`}
        style={{ border: '1px solid var(--color-border)', overflow: 'hidden' }}
      >
        <table
          style={{ width: '100%', fontSize: 'var(--font-size-sm)', borderCollapse: 'collapse' }}
        >
          <thead
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <tr>
              <th style={{ ...thBase, textAlign: 'left' }}>주문일시</th>
              <th style={{ ...thBase, textAlign: 'left' }}>주문번호</th>
              <th style={{ ...thBase, textAlign: 'left' }}>고객 · 상품</th>
              <th style={{ ...thBase, textAlign: 'left' }}>가게</th>
              <th style={{ ...thBase, textAlign: 'left' }}>상태</th>
              <th style={{ ...thBase, textAlign: 'right' }}>금액</th>
              <th style={{ padding: '12px 16px' }} />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                  <p className={TEXT} style={metaText}>
                    {formatOrderedAt(order.createdAt)}
                  </p>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <p
                    className={`${TEXT} font-mono`}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    {order.orderNumber ?? `${order.id.slice(0, 12)}…`}
                  </p>
                  <RequestNote note={order.requestNote} />
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <BuyerAndProduct order={order} />
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <p className={TEXT} style={metaText}>
                    {storeLabel(order)}
                  </p>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <StatusBadges order={order} />
                </td>
                <td
                  style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  ₩{order.totalAmount.toLocaleString()}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  {isRefundable(order) && (
                    <Button
                      onClick={() => onRefund(order)}
                      disabled={processingIds.has(order.id)}
                      size="xs"
                      variant="outline-destructive"
                      className="rounded-[8px]"
                    >
                      {processingIds.has(order.id) ? '처리중…' : '강제환불'}
                    </Button>
                  )}
                  {onPostDeliveryRefund && isPostDeliveryRefundable(order) && (
                    <Button
                      onClick={() => onPostDeliveryRefund(order)}
                      disabled={processingIds.has(order.id)}
                      size="xs"
                      variant="outline-destructive"
                      className="rounded-[8px]"
                    >
                      {processingIds.has(order.id) ? '처리중…' : '배송 후 환불'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
