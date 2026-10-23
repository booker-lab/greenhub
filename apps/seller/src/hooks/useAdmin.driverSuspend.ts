/**
 * 기사 정지 응답의 배송 중 배정 주문 수 — 순수 함수.
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * API는 정지(suspended: true) 응답에 `activeDeliveryCount`(그 기사에게 배정된 DELIVERING 주문 수)를
 * 싣는다. 조회에 실패하면 정지는 그대로 두고 null을 보낸다. 정지 자체는 막지 않는다.
 */

/** 응답 본문에서 건수를 읽는다. 0건·필드 없음은 0, 서버가 세지 못했으면(null) null. */
export function readActiveDeliveryCount(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return 0;
  const count = (body as Record<string, unknown>).activeDeliveryCount;
  if (count === null) return null;
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
}

/** 정지 뒤 안내 문구. 배송 중 주문이 없으면 null(안내 없음). */
export function describeActiveDeliveryWarning(count: number | null): string | null {
  if (count === null) {
    return '배송 중인 주문이 있는지 확인하지 못했어요. 이 기사에게 배정된 배송 중 주문이 있으면 판매자가 배송 보류로 바꿔야 합니다.';
  }
  if (count === 0) return null;
  return `배송 중인 주문 ${count}건이 있어요 — 판매자가 배송 보류로 바꿔야 합니다.`;
}
