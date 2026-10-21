/**
 * 정산 집계 — 순수 함수 (SDD 비즈니스 레이어, B-3)
 *
 * getSummary의 byStatus 카운트·금액 합산 루프를 추출.
 * Firestore 의존 없음(이미 읽어온 문서 배열만 받음) → 단위 테스트 용이.
 *
 * 상태 타입·키 목록 SSOT = @greenhub/shared(F-1/S4). 로컬 SettlementStatusKey 제거.
 */

import { SETTLEMENT_STATUSES, type SettlementStatus } from '@greenhub/shared';

export interface SettlementAggregate {
  count: number;
  totalAmount: number;
  totalPlatformFee: number;
  totalNetAmount: number;
  byStatus: Record<SettlementStatus, number>;
  /** 지급 뒤 환불돼 판매자에게서 돌려받을 돈(회수 대기 PENDING)의 건수·합계 */
  recoveryPendingCount: number;
  recoveryPendingAmount: number;
}

/**
 * 정산 문서 배열을 상태별 건수 + 금액 합계로 집계.
 * 기존 getSummary 루프와 동작 동일(status가 4상태 외면 byStatus 미카운트, 금액은 합산).
 */
export function aggregateSettlements(
  settlements: Record<string, unknown>[],
): SettlementAggregate {
  const byStatus: Record<SettlementStatus, number> = {
    pending: 0,
    confirmed: 0,
    paid: 0,
    cancelled: 0,
  };
  let totalAmount = 0;
  let totalPlatformFee = 0;
  let totalNetAmount = 0;
  let recoveryPendingCount = 0;
  let recoveryPendingAmount = 0;

  for (const s of settlements) {
    const status = s['status'] as SettlementStatus;
    if (SETTLEMENT_STATUSES.includes(status)) byStatus[status]++;
    totalAmount += (s['totalAmount'] as number) ?? 0;
    totalPlatformFee += (s['platformFee'] as number) ?? 0;
    totalNetAmount += (s['netAmount'] as number) ?? 0;
    const recovery = s['recovery'] as { status?: unknown; amount?: unknown } | null | undefined;
    if (recovery?.status === 'PENDING') {
      recoveryPendingCount++;
      recoveryPendingAmount += typeof recovery.amount === 'number' ? recovery.amount : 0;
    }
  }

  return {
    count: settlements.length,
    totalAmount,
    totalPlatformFee,
    totalNetAmount,
    byStatus,
    recoveryPendingCount,
    recoveryPendingAmount,
  };
}
