'use client';

import { Button } from '@greenhub/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDotsIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@greenhub/ui/components/dropdown-menu';
import { StatusDot } from '@greenhub/ui/components/status-dot';
import type { AdminOrder } from '@/hooks/useAdmin';
import {
  ADMIN_NUM,
  ADMIN_SUB,
  ADMIN_TD,
  ADMIN_TEXT_ACTION,
  ADMIN_TH,
  formatWon,
  maskPersonName,
} from '../../_components/adminList';
import {
  cancellationState,
  formatOrderedAt,
  getAdminOrdersReadState,
  getStatusTone,
  type OrderRowAction,
  orderRowActions,
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
  /** 배송 완료 회차 주문의 배송 후 환불 확인창을 띄운다. 없으면 메뉴에 넣지 않는다. */
  onPostDeliveryRefund?: (order: AdminOrder) => void;
  /** 조회 실패 시 재시도 — hook의 reload()에 연결된다. */
  onRetry: () => void;
}

// ② 방향(design-direction.md §5 어드민 "주문", §8 D7): 줄무늬·머리 띠·그림자 없는 표.
// 열: 상품(굵게) → 주문번호·주문자(가린 이름) → 가게 → 상태·주문 시각 → 금액(굵게, 오른쪽) → 처리·⋮.
// 태블릿(1100px 이하)은 가게 열을 상품 아래 보조 줄로 옮기고, 휴대폰(640px 이하)은 모든 목록이 같은 세 줄 행이다.
// 폭 기준 클래스는 Tailwind가 소스 글자로 찾으므로 조합하지 않고 그대로 쓴다.

/** 주문번호 — 없는 옛 주문은 잘린 id 대신 "주문번호 없음"(전체 id는 확인창에서 보인다). */
function orderNumberLabel(order: AdminOrder): string {
  return order.orderNumber ?? '주문번호 없음';
}

// 요청사항은 표 폭을 넓히지 않도록 상품 아래 13px 회색으로 최대 2줄만 보여준다.
export function RequestNote({ note }: { note?: string | null }) {
  const text = note?.trim();
  if (!text) return null;
  return (
    <p
      className={`${ADMIN_SUB} line-clamp-2 max-w-[280px] break-words whitespace-pre-wrap`}
      title={text}
    >
      요청: {text}
    </p>
  );
}

// 상태 점 + 글자, 환불 진행·실패가 있으면 그 점 + 글자를 하나 더 — 표·휴대폰 행 공용.
export function OrderStatus({ order, size = 15 }: { order: AdminOrder; size?: 13 | 15 }) {
  const cancel = cancellationState(order.cancellationStatus);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <StatusDot tone={getStatusTone(order.status)} size={size}>
        {STATUS_LABEL[order.status] ?? order.status}
      </StatusDot>
      {cancel && (
        <StatusDot tone={cancel.tone} size={size}>
          {cancel.label}
        </StatusDot>
      )}
    </span>
  );
}

/** 주문번호 · 가린 주문자 — 낱말 덩어리마다 줄바꿈 금지. */
function OrderIdentity({ order }: { order: AdminOrder }) {
  const buyer = maskPersonName(order.buyerName);
  return (
    <>
      <span className="whitespace-nowrap tabular-nums">{orderNumberLabel(order)}</span>
      {buyer && (
        <>
          {' · '}
          <span className="whitespace-nowrap">{buyer}</span>
        </>
      )}
    </>
  );
}

function RowActions({
  order,
  processing,
  allowPostDelivery,
  onAction,
}: {
  order: AdminOrder;
  processing: boolean;
  allowPostDelivery: boolean;
  onAction: (action: OrderRowAction, order: AdminOrder) => void;
}) {
  const { primary, menu: allItems } = orderRowActions(order);
  const menu = allowPostDelivery
    ? allItems
    : allItems.filter((item) => item.action !== 'post-delivery-refund');
  const label = orderNumberLabel(order);
  if (processing) {
    return (
      <span className="text-[13px] whitespace-nowrap text-[var(--color-text-secondary)]">
        처리 중…
      </span>
    );
  }
  return (
    <span className="flex items-center justify-end gap-1">
      {primary && (
        <button
          type="button"
          className={ADMIN_TEXT_ACTION}
          aria-label={`주문 ${label} 환불`}
          onClick={() => onAction(primary, order)}
        >
          환불
        </button>
      )}
      {menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`주문 ${label} 동작 더 보기`}>
            <DropdownMenuDotsIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {menu.map((item) => (
              <DropdownMenuItem key={item.action} onClick={() => onAction(item.action, order)}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        !primary && <span className="block size-11" aria-hidden="true" />
      )}
    </span>
  );
}

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
      <p className="m-0 py-20 text-center text-[15px] text-[var(--color-text-secondary)]">
        불러오는 중...
      </p>
    );
  }

  // 조회 실패는 성공-empty와 구조적으로 구분 — "주문이 없습니다."로 collapse 금지.
  if (readState === 'FETCH_ERROR') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[8px] border border-rule px-4 py-16">
        <p className="m-0 text-[15px] font-medium text-foreground">
          주문 목록을 불러오지 못했습니다.
        </p>
        <p className="m-0 text-center text-[13px] text-[var(--color-text-secondary)]">{error}</p>
        <Button onClick={onRetry} variant="outline" className="rounded-[8px]">
          다시 조회
        </Button>
      </div>
    );
  }

  if (readState === 'EMPTY') {
    return (
      <p className="m-0 rounded-[8px] border border-rule py-16 text-center text-[15px] text-[var(--color-text-secondary)]">
        주문이 없습니다.
      </p>
    );
  }

  const onAction = (action: OrderRowAction, order: AdminOrder) => {
    if (action === 'refund') onRefund(order);
    else onPostDeliveryRefund?.(order);
  };
  const actionsOf = (order: AdminOrder) => (
    <RowActions
      order={order}
      processing={processingIds.has(order.id)}
      allowPostDelivery={onPostDeliveryRefund !== undefined}
      onAction={onAction}
    />
  );

  return (
    <>
      {/* 휴대폰(640px 이하): 세 줄 행 — 1줄 상품·금액, 2줄 주문번호·주문자와 오른쪽 상태, 3줄 가게·시각, 옆에 동작 한 자리. */}
      <ul className="m-0 list-none p-0 min-[641px]:hidden" aria-label="주문 목록">
        {orders.map((order) => (
          <li
            key={order.id}
            className="flex items-center gap-2 border-b border-rule py-2.5 [word-break:keep-all]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="m-0 min-w-0 text-[15px] leading-[22px] font-bold">
                  {order.productSummary?.trim() || '상품 정보 없음'}
                </p>
                <p className={`m-0 text-[15px] leading-[22px] font-bold ${ADMIN_NUM}`}>
                  {formatWon(order.totalAmount)}
                </p>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className={`${ADMIN_SUB} min-w-0`}>
                  <OrderIdentity order={order} />
                </p>
                <OrderStatus order={order} size={13} />
              </div>
              <p className={ADMIN_SUB}>
                {storeLabel(order)} ·{' '}
                <span className="whitespace-nowrap tabular-nums">
                  {formatOrderedAt(order.createdAt)}
                </span>
              </p>
              <RequestNote note={order.requestNote} />
            </div>
            {/* 동작은 세 줄 옆 고정 폭 한 자리 — 금액·상태의 오른쪽 끝선을 모든 행에서 맞추고 행 높이를 바꾸지 않는다. */}
            <div className="flex w-11 shrink-0 justify-center">{actionsOf(order)}</div>
          </li>
        ))}
      </ul>

      {/* 태블릿·데스크톱(641px 이상): 표. 1100px 이하는 가게 열을 상품 아래 보조 줄로 옮긴다. */}
      <table className="w-full border-collapse max-[640px]:hidden">
        <thead>
          <tr>
            <th className={ADMIN_TH}>상품</th>
            <th className={ADMIN_TH}>주문번호 · 주문자</th>
            <th className={`${ADMIN_TH} max-[1100px]:hidden`}>가게</th>
            <th className={ADMIN_TH}>상태 · 주문 시각</th>
            <th className={`${ADMIN_TH} text-right`}>금액</th>
            <th className={`${ADMIN_TH} w-[112px]`}>
              <span className="sr-only">처리</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td className={`${ADMIN_TD} [word-break:keep-all]`}>
                <p className="m-0 font-bold">{order.productSummary?.trim() || '상품 정보 없음'}</p>
                <p className={`${ADMIN_SUB} min-[1101px]:hidden`}>{storeLabel(order)}</p>
                <RequestNote note={order.requestNote} />
              </td>
              <td className={ADMIN_TD}>
                <OrderIdentity order={order} />
              </td>
              <td className={`${ADMIN_TD} max-[1100px]:hidden [word-break:keep-all]`}>
                {storeLabel(order)}
              </td>
              <td className={ADMIN_TD}>
                <OrderStatus order={order} />
                <p className={`${ADMIN_SUB} whitespace-nowrap tabular-nums`}>
                  {formatOrderedAt(order.createdAt)}
                </p>
              </td>
              <td className={`${ADMIN_TD} ${ADMIN_NUM} font-bold`}>
                {formatWon(order.totalAmount)}
              </td>
              <td className={`${ADMIN_TD} py-1 text-right align-middle`}>{actionsOf(order)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
