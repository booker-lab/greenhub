/**
 * 정산 수수료 계산 — 순수 함수 (SDD 비즈니스 레이어, B-3)
 *
 * Firestore/인증 등 인프라 의존 없음 → 단위 테스트 용이.
 * settlements.service.ts(인프라·인증 레이어)에서 호출.
 */

export interface FeeBreakdown {
  /** 플랫폼 수수료 = floor(totalAmount × feeRate) */
  platformFee: number;
  /** 판매자 실수령액 = totalAmount - platformFee */
  netAmount: number;
}

/**
 * 주문 총액과 수수료율로 플랫폼 수수료·실수령액 산출.
 * 수수료는 원 단위 버림(`Math.floor`) — 기존 createSettlement 동작 동일.
 */
export function calcFee(totalAmount: number, feeRate: number): FeeBreakdown {
  const platformFee = Math.floor(totalAmount * feeRate);
  return {
    platformFee,
    netAmount: totalAmount - platformFee,
  };
}
