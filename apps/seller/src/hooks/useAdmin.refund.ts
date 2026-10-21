/**
 * 관리자 강제 환불 응답의 판매자 회수 정보(결정 ④) — 순수 함수.
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * 이미 판매자에게 지급한(paid) 정산의 주문을 환불하면 API가 `recoveryRequired: true`와
 * `recoveryAmount`(그 정산의 판매자 지급액)를 응답에 싣는다. 정산 상태는 paid로 남고
 * 관리자만 닫는 운영 기록(정산 회수 필요)이 열린다.
 */

export interface RefundRecovery {
  amount: number;
}

/** 응답 본문에서 회수 정보를 읽는다. 회수가 필요 없거나 형식이 맞지 않으면 null. */
export function readRefundRecovery(body: unknown): RefundRecovery | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.recoveryRequired !== true) return null;
  const amount = record.recoveryAmount;
  return { amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : 0 };
}

/** 환불 결과 알림 문구. */
export function describeRefundRecovery(recovery: RefundRecovery): string {
  return `이미 지급한 정산입니다. 판매자에게 ${recovery.amount.toLocaleString('ko-KR')}원을 돌려받아야 합니다. 정산 화면과 운영 기록(정산 회수 필요)에서 확인하세요.`;
}
