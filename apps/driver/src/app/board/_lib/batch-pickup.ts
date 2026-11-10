/**
 * 한 번에 수거(여러 주문 배송 시작) 순수 계약.
 *
 * 작업 보드 수거 대기 탭에서 내게 배정된 회차 직배송 주문 여러 건을 골라 확인 창 한 번으로
 * 주문마다 기존 상태 변경(`PATCH /stores/{storeId}/orders/{orderId}/status` `{status:'DELIVERING'}`)을
 * 차례로 보낸다. 주문별 결과 판정은 상세 화면의 규칙(driver-order-detail.ts)을 그대로 쓴다.
 *
 * - ACK: 응답 orderId·status가 요청과 같아야 시작으로 본다(isDriverOrderStatusAck).
 * - 401·AUTHORITY_LOSS: 즉시 멈추고 남은 주문은 보내지 않는다(호출자는 인증 오류 화면으로 수렴).
 * - STATE_CONFLICT·NOT_FOUND: 다른 기사가 맡았거나 이미 상태가 바뀐 주문이다("이미 바뀜").
 * - 그 밖(시간 초과·네트워크·5xx·ACK 불일치·본문 해석 실패): 같은 요청을 자동으로 다시 보내지 않고
 *   "확인 필요"로 둔다. 서버는 이미 적용된 같은 전이를 STATE_CONFLICT로 거절하므로 기사가 다시 눌러도
 *   두 번 처리되지 않는다.
 *
 * 실제 허용 판정은 언제나 서버(API Core gate)가 한다. 여기서는 서버가 반드시 허용하는 부분집합만 고를 수 있게 한다.
 */

import type { RedeliveryPaymentActionability } from '@greenhub/shared';
import { isSafeApiPathSegment } from '@greenhub/shared';
// vitest에서 `@/` 별칭 없이 읽히도록 상대 경로로 둔다.
import { splitDeliveryAddress } from '../../../lib/address-parts';
import {
  classifyDriverOrderCommandError,
  driverOrderItemCount,
  isDriverOrderStatusAck,
  readDriverOrderErrorCode,
} from './driver-order-detail';
import { isDeliveryStartAllowed } from './redelivery-payment';

export const BATCH_PICKUP_TARGET_STATUS = 'DELIVERING';

export type BatchPickupCandidate = {
  id: string;
  status: string;
  /** 요청한 기사 본인에게 배정된 주문인지. 이전 API 응답에는 없다. */
  assignedToMe?: boolean;
  /** 상태 변경 경로에 쓴다. 목록에 싣지 않던 이전 API 응답에는 없다. */
  storeId?: unknown;
  deliveryMethod?: string;
  schemaVersion?: unknown;
  roundId?: unknown;
  /** 회차 직배송 주문에만 목록 API가 싣는 회차 배송 시작 시각. */
  deliveryDate?: unknown;
  redeliveryPayment?: RedeliveryPaymentActionability | null;
};

/**
 * 목록 행이 회차 직배송 주문인가.
 *
 * 상세는 `schemaVersion === 2 && roundId && deliveryMethod === 'direct'`로 판정한다. 목록 응답은
 * schemaVersion·roundId를 싣지 않고, 회차 배송일(`deliveryDate`)은 노출 판정이 회차 직배송 기준으로 본
 * 주문에만 싣는다(apps/api driver.service.ts). 그래서 목록이 상세와 같은 값을 실으면 상세 규칙을 그대로 쓰고,
 * 아니면 직배송 + 회차 배송일로 본다. 어느 쪽도 확인되지 않으면 회차 직배송이 아닌 것으로 본다(고를 수 없음).
 */
export function isRoundDirectListOrder(order: BatchPickupCandidate): boolean {
  if (order.deliveryMethod !== 'direct') return false;
  if (order.schemaVersion !== undefined || order.roundId !== undefined) {
    return (
      order.schemaVersion === 2 && typeof order.roundId === 'string' && order.roundId.length > 0
    );
  }
  return typeof order.deliveryDate === 'string' && order.deliveryDate.length > 0;
}

/** 고를 수 없는 까닭. null이면 고를 수 있다. */
export type BatchPickupBlockReason =
  | 'NOT_PREPARING'
  | 'NOT_MINE'
  | 'NOT_ROUND_DIRECT'
  | 'PAYMENT'
  | 'NO_STORE';

export function batchPickupBlockReason(order: BatchPickupCandidate): BatchPickupBlockReason | null {
  if (order.status !== 'PREPARING') return 'NOT_PREPARING';
  // 맡을 수 있는 주문(미배정)과 배정 여부를 모르는 이전 응답은 고를 수 없다.
  if (order.assignedToMe !== true) return 'NOT_MINE';
  if (!isRoundDirectListOrder(order)) return 'NOT_ROUND_DIRECT';
  if (!isDeliveryStartAllowed(order.redeliveryPayment)) return 'PAYMENT';
  // storeId가 없으면(이전 API) 상태 변경 경로를 만들 수 없다. 형식이 어긋난 값도 보내지 않는다.
  if (!isSafeApiPathSegment(order.storeId)) return 'NO_STORE';
  if (!isSafeApiPathSegment(order.id)) return 'NO_STORE';
  return null;
}

export function isBatchPickupSelectable(order: BatchPickupCandidate): boolean {
  return batchPickupBlockReason(order) === null;
}

/** 내 수거 행에 쓰는 짧은 안내. 미배정·수거 대기가 아닌 주문은 행에 고르기 칸을 두지 않으므로 null이다. */
export function batchPickupBlockLabel(reason: BatchPickupBlockReason | null): string | null {
  if (reason === 'PAYMENT') return '결제 확인 전이라 고를 수 없어요';
  if (reason === 'NOT_ROUND_DIRECT' || reason === 'NO_STORE') {
    return '한 번에 시작할 수 없어요. 고르기를 마친 뒤 주문을 열어 시작해 주세요';
  }
  return null;
}

/** 한 주문의 결과. NOT_SENT는 앞선 인증 상실·화면 이탈·세션 전환으로 보내지 않은 주문이다. */
export type BatchPickupOutcome =
  | 'STARTED'
  | 'ALREADY_CHANGED'
  | 'NEEDS_CHECK'
  | 'AUTH_LOST'
  | 'NOT_SENT';

/** fetch Response에서 판정에 쓰는 부분. */
export type BatchPickupResponse = Pick<Response, 'ok' | 'status' | 'json'>;

/**
 * 상태 변경 응답 하나를 판정한다. 상세 화면의 updateStatus와 같은 규칙이다.
 * 본문 해석 실패는 던지지 않고 판정에 반영한다(2xx면 확인 필요, 오류면 코드 없음).
 */
export async function classifyBatchPickupResponse(
  response: BatchPickupResponse,
  orderId: string,
): Promise<Exclude<BatchPickupOutcome, 'NOT_SENT'>> {
  // 401은 본문과 무관하게 인증 상실이다(상세와 같이 본문을 읽지 않는다).
  if (!response.ok && response.status === 401) return 'AUTH_LOST';
  let body: unknown;
  let readable = true;
  try {
    body = await response.json();
  } catch {
    readable = false;
  }
  if (response.ok) {
    if (!readable || typeof body !== 'object' || body === null) return 'NEEDS_CHECK';
    return isDriverOrderStatusAck(
      body as { orderId?: unknown; status?: unknown },
      orderId,
      BATCH_PICKUP_TARGET_STATUS,
    )
      ? 'STARTED'
      : 'NEEDS_CHECK';
  }
  const recovery = classifyDriverOrderCommandError({
    status: response.status,
    code: readable ? readDriverOrderErrorCode(body) : null,
  });
  if (recovery === 'AUTHORITY_LOSS') return 'AUTH_LOST';
  if (recovery === 'STATE_CONFLICT' || recovery === 'NOT_FOUND') return 'ALREADY_CHANGED';
  return 'NEEDS_CHECK';
}

export type BatchPickupItemResult = { orderId: string; outcome: BatchPickupOutcome };

export type BatchPickupRun = {
  results: BatchPickupItemResult[];
  /** AUTH_LOST: 인증 상실로 멈춤. INTERRUPTED: 화면 이탈·세션 전환으로 멈춤. null: 끝까지 보냄. */
  stoppedBy: 'AUTH_LOST' | 'INTERRUPTED' | null;
};

/**
 * 고른 주문에 상태 변경을 차례로 하나씩 보낸다(앞 응답을 받은 뒤 다음을 보낸다. 동시에 보내지 않는다).
 *
 * - 주문마다 send는 많아야 한 번이다. 불확실한 결과도 같은 요청을 다시 보내지 않는다.
 * - 보내기 전마다 isCurrent()를 본다. 화면을 떠났거나 세션 scope가 바뀌었으면 남은 주문은 보내지 않는다.
 * - 응답이 온 뒤 scope가 바뀌었으면 그 주문은 확인 필요로 두고 멈춘다(결과를 새 화면에 쓰지 않게 호출자가 막는다).
 * - 인증 상실이면 즉시 멈추고 남은 주문은 보내지 않는다.
 */
export async function runBatchPickup<T extends { id: string }>(args: {
  orders: readonly T[];
  send: (order: T) => Promise<BatchPickupResponse>;
  isCurrent: () => boolean;
  onProgress?: (done: number) => void;
}): Promise<BatchPickupRun> {
  const { orders, send, isCurrent, onProgress } = args;
  const results: BatchPickupItemResult[] = orders.map((order) => ({
    orderId: order.id,
    outcome: 'NOT_SENT',
  }));
  for (let index = 0; index < orders.length; index += 1) {
    if (!isCurrent()) return { results, stoppedBy: 'INTERRUPTED' };
    const order = orders[index];
    let outcome: Exclude<BatchPickupOutcome, 'NOT_SENT'>;
    try {
      const response = await send(order);
      if (!isCurrent()) {
        results[index] = { orderId: order.id, outcome: 'NEEDS_CHECK' };
        return { results, stoppedBy: 'INTERRUPTED' };
      }
      outcome = await classifyBatchPickupResponse(response, order.id);
    } catch {
      // 시간 초과·네트워크 오류: 서버가 이미 처리했을 수 있다. 다시 보내지 않는다.
      outcome = 'NEEDS_CHECK';
    }
    results[index] = { orderId: order.id, outcome };
    onProgress?.(index + 1);
    if (outcome === 'AUTH_LOST') return { results, stoppedBy: 'AUTH_LOST' };
  }
  return { results, stoppedBy: null };
}

export type BatchPickupSummary = {
  started: number;
  alreadyChanged: number;
  needsCheck: number;
  notSent: number;
};

export function summarizeBatchPickup(
  results: readonly BatchPickupItemResult[],
): BatchPickupSummary {
  const summary: BatchPickupSummary = { started: 0, alreadyChanged: 0, needsCheck: 0, notSent: 0 };
  for (const { outcome } of results) {
    if (outcome === 'STARTED') summary.started += 1;
    else if (outcome === 'ALREADY_CHANGED') summary.alreadyChanged += 1;
    else if (outcome === 'NEEDS_CHECK') summary.needsCheck += 1;
    else if (outcome === 'NOT_SENT') summary.notSent += 1;
  }
  return summary;
}

/** 결과 요약 한 줄과 안내. 0인 항목은 시작 수를 빼고 쓰지 않는다. */
export function buildBatchPickupSummaryText(summary: BatchPickupSummary): {
  line: string;
  notes: string[];
} {
  const parts = [`배송 시작 ${summary.started}곳`];
  if (summary.alreadyChanged > 0) parts.push(`이미 바뀜 ${summary.alreadyChanged}곳`);
  if (summary.needsCheck > 0) parts.push(`확인 필요 ${summary.needsCheck}곳`);
  if (summary.notSent > 0) parts.push(`보내지 않음 ${summary.notSent}곳`);
  const notes: string[] = [];
  if (summary.alreadyChanged > 0) {
    notes.push('이미 바뀐 주문은 다른 기사가 맡았거나 상태가 먼저 바뀐 주문이에요.');
  }
  if (summary.needsCheck > 0) {
    notes.push(
      '확인 필요 주문은 처리됐는지 아직 몰라요. 배송 중 탭에서 확인하고, 목록이 오래됐으면 다시 시도해 주세요.',
    );
  }
  return { line: parts.join(' · '), notes };
}

export type BatchPickupConfirmOrder = {
  id: string;
  address?: string | null;
  deliveryAddress?: { address?: string } | null;
  items?: unknown;
  quantity?: number | null;
};

export type BatchPickupConfirmContent = {
  title: string;
  /** 주문마다 한 줄: 동·호수 · 기본 주소(나눌 수 없으면 전체 주소). */
  places: { id: string; place: string }[];
  /** "상품 총 N개". 한 주문이라도 수량을 모르면 null(지어내지 않는다). */
  itemsLine: string | null;
  notice: string;
  confirmLabel: string;
};

/** 한 번에 수거 확인 창 문구. 상세 확인 창(buildDriverStatusConfirmContent)과 같은 사실(주소·상품 수·알림)을 보인다. */
export function buildBatchPickupConfirmContent(
  orders: readonly BatchPickupConfirmOrder[],
): BatchPickupConfirmContent {
  const count = orders.length;
  const places = orders.map((order) => {
    const parts = splitDeliveryAddress(order.address, order.deliveryAddress?.address);
    const place = parts ? (parts.detail ? `${parts.detail} · ${parts.base}` : parts.base) : '-';
    return { id: order.id, place };
  });
  let total: number | null = 0;
  for (const order of orders) {
    const itemCount = driverOrderItemCount(order.items, order.quantity);
    if (itemCount === null || total === null) {
      total = null;
      break;
    }
    total += itemCount;
  }
  return {
    title: `${count}곳 배송을 시작할까요?`,
    places,
    itemsLine: total !== null && count > 0 ? `상품 총 ${total}개` : null,
    notice: `손님 ${count}명에게 배송 시작 알림이 가요.`,
    confirmLabel: `${count}곳 배송 시작`,
  };
}
