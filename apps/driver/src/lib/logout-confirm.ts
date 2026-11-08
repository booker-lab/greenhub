// 로그아웃 확인 문구. 내 정보 화면이 서버에서 기사 목록을 한 번 읽어 배송 중·보류 주문 수를 센다.
// 목록 API가 보여 주는 배송 중·보류 주문은 모두 요청한 기사 본인에게 배정된 주문이다(노출 판정).

export type ActiveDeliverySummary = { delivering: number; held: number };

/** 목록 응답에서 배송 중·보류 주문 수를 센다. 목록이 아니면 null(확인 없이 기존대로 로그아웃). */
export function summarizeActiveDeliveries(payload: unknown): ActiveDeliverySummary | null {
  if (!Array.isArray(payload)) return null;
  let delivering = 0;
  let held = 0;
  for (const order of payload) {
    if (typeof order !== 'object' || order === null) continue;
    const status = (order as { status?: unknown }).status;
    if (status === 'DELIVERING') delivering += 1;
    else if (status === 'DELIVERY_HELD') held += 1;
  }
  return { delivering, held };
}

/** 배송 중·보류 주문이 있으면 확인 문구, 없거나 셀 수 없으면 null. */
export function logoutConfirmMessage(summary: ActiveDeliverySummary | null): string | null {
  if (!summary) return null;
  const { delivering, held } = summary;
  if (delivering > 0 && held > 0) {
    return `배송 중인 주문 ${delivering}건, 보류 중인 주문 ${held}건이 있어요. 로그아웃할까요?`;
  }
  if (delivering > 0) return `배송 중인 주문 ${delivering}건이 있어요. 로그아웃할까요?`;
  if (held > 0) return `보류 중인 주문 ${held}건이 있어요. 로그아웃할까요?`;
  return null;
}
