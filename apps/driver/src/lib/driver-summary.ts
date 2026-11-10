// 기사 요약(`GET /driver/summary` → `{ completedToday: number }`) 읽기.
// 오늘(서울 날짜) 내게 배정돼 배송 완료된 수만 쓰고 손님 정보는 없다. 형식이 어긋나면 null이고 화면은 그 부분만 숨긴다.

export function readDriverSummaryCompletedToday(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const value = (payload as { completedToday?: unknown }).completedToday;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
