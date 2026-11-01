import type { SettlementStatus } from '../_constants';

// ② 상태는 배지 면 대신 점 + 글자(StatusDot, 2026-11-01 결정): 끝났거나 멈춘 상태(지급 완료·취소)=회색,
// 나머지(정산 대기·확정) 검정. 어드민 정산(`settlementStatusTone`)과 같은 규칙이다.
export function settlementStatusTone(status: SettlementStatus): 'done' | 'default' {
  return status === 'paid' || status === 'cancelled' ? 'done' : 'default';
}
