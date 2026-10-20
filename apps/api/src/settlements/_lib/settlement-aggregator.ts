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
  /** 상태별 판매자 지급액(netAmount) 합계. 관리자 화면의 지급 대기(confirmed)·지급 완료(paid) 합계에 쓴다. */
  netByStatus: Record<SettlementStatus, number>;
  /** 상태별 플랫폼 수수료(platformFee) 합계. */
  feeByStatus: Record<SettlementStatus, number>;
}

function emptyByStatus(): Record<SettlementStatus, number> {
  return { pending: 0, confirmed: 0, paid: 0, cancelled: 0 };
}

/**
 * 정산 문서 배열을 상태별 건수 + 금액 합계로 집계.
 * 기존 getSummary 루프와 동작 동일(status가 4상태 외면 byStatus 미카운트, 금액은 합산).
 */
export function aggregateSettlements(
  settlements: Record<string, unknown>[],
): SettlementAggregate {
  const byStatus = emptyByStatus();
  const netByStatus = emptyByStatus();
  const feeByStatus = emptyByStatus();
  let totalAmount = 0;
  let totalPlatformFee = 0;
  let totalNetAmount = 0;

  for (const s of settlements) {
    const status = s['status'] as SettlementStatus;
    const fee = (s['platformFee'] as number) ?? 0;
    const net = (s['netAmount'] as number) ?? 0;
    if (SETTLEMENT_STATUSES.includes(status)) {
      byStatus[status]++;
      netByStatus[status] += net;
      feeByStatus[status] += fee;
    }
    totalAmount += (s['totalAmount'] as number) ?? 0;
    totalPlatformFee += fee;
    totalNetAmount += net;
  }

  return {
    count: settlements.length,
    totalAmount,
    totalPlatformFee,
    totalNetAmount,
    byStatus,
    netByStatus,
    feeByStatus,
  };
}
