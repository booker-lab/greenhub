// 어드민 정산 화면 공용 유틸 (F-2/S5).
import type { AdminSettlement } from '@/hooks/useAdmin';

/**
 * 정산일시 표기 포매터 — 브라우저 시간대와 무관하게 항상 KST(Asia/Seoul)로 표시.
 * shared `toDateStrKST`는 YYYY-MM-DD만 지원하므로 시·분 표시는 timeZone 지정으로 해결.
 */
const SETTLED_AT_FORMAT_KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * 정산일시 표기 — settledAt 직렬화 형태가 호출 경로마다 다름(#CL-46).
 * API TimestampInterceptor는 ISO 문자열, Firestore raw 직렬화는 `{ _seconds }`.
 * 양쪽 모두 방어적으로 파싱하고, 불가하면 '-'.
 */
export function toDateStr(ts: unknown): string {
  let date: Date | null = null;
  if (typeof ts === 'string') {
    const d = new Date(ts);
    date = Number.isNaN(d.getTime()) ? null : d;
  } else if (ts && typeof ts === 'object' && '_seconds' in ts) {
    date = new Date((ts as { _seconds: number })._seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return '-';
  return SETTLED_AT_FORMAT_KST.format(date);
}

export function toKRW(n: number): string {
  return `₩${n.toLocaleString('ko-KR')}`;
}

/**
 * N11(F-2): 지급 합계는 confirmed + paid 정산만 합산.
 * pending(미확정)·cancelled(취소)는 실제 지급 대상이 아니므로 제외 — 과대 표시 방지.
 */
export function sumPayable(settlements: AdminSettlement[]) {
  return settlements
    .filter((s) => s.status === 'confirmed' || s.status === 'paid')
    .reduce(
      (acc, s) => {
        acc.totalFee += s.platformFee;
        acc.totalNet += s.netAmount;
        return acc;
      },
      { totalFee: 0, totalNet: 0 },
    );
}

/**
 * 지급 확인창 문구 — 어느 가게·주문에 얼마를 지급 완료로 표시하는지 보여 준다.
 * 정산 문서에는 가게 이름이 없어 가게 ID 전체를 보이고, 주문번호가 없는 옛 정산은 주문 ID를 보인다.
 */
export function describePayConfirm(
  s: Pick<AdminSettlement, 'storeId' | 'orderId' | 'orderNumber' | 'netAmount'>,
): string {
  return [
    `가게 ID: ${s.storeId}`,
    s.orderNumber ? `주문번호: ${s.orderNumber}` : `주문 ID: ${s.orderId}`,
    `지급액: ${toKRW(s.netAmount)}`,
    '',
    '이 정산을 지급 완료 처리하시겠습니까?',
  ].join('\n');
}

/** 지급 뒤 환불돼 판매자에게서 돌려받을 돈이 남은 정산인지(회수 대기). */
export function isRecoveryPending(s: Pick<AdminSettlement, 'recovery'>): boolean {
  return s.recovery?.status === 'PENDING';
}

/** 화면에 보이는 정산 중 돌려받을 돈의 건수·합계. */
export function sumRecoveryPending(settlements: AdminSettlement[]) {
  return settlements.filter(isRecoveryPending).reduce(
    (acc, s) => {
      acc.count += 1;
      acc.amount += s.recovery?.amount ?? 0;
      return acc;
    },
    { count: 0, amount: 0 },
  );
}

/** 회수 완료 확인창 문구 — 어느 가게·주문에서 얼마를 받았는지 확인하게 한다. */
export function describeRecoveryConfirm(
  s: Pick<AdminSettlement, 'storeId' | 'orderId' | 'orderNumber' | 'recovery'>,
): string {
  return [
    `가게 ID: ${s.storeId}`,
    s.orderNumber ? `주문번호: ${s.orderNumber}` : `주문 ID: ${s.orderId}`,
    `돌려받을 돈: ${toKRW(s.recovery?.amount ?? 0)}`,
    '',
    '판매자에게서 이 금액을 계좌로 받았다면 회수 완료로 표시합니다.',
  ].join('\n');
}
