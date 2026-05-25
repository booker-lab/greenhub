// 주문 상태 라벨/색 — orders 탭 표현 SSOT(테이블·카드·필터 공용).
export const STATUS_LABEL: Record<string, string> = {
  PENDING: '결제대기',
  RECRUITING: '모집중',
  ACCEPTED: '접수됨',
  CONFIRMED: '확정',
  PREPARING: '준비중',
  DELIVERING: '배달중',
  HUB_ARRIVED: '거점도착',
  PICKED_UP: '픽업완료',
  DELIVERED: '배달완료',
  REVIEWED: '리뷰완료',
  CANCELLED: '취소됨',
};

export function getStatusColor(status: string): string {
  if (status === 'CANCELLED') return 'red';
  if (status === 'DELIVERED' || status === 'REVIEWED') return 'green';
  return 'yellow';
}

// 강제환불 가능 상태 — 배달 진행 전까지만 허용.
export const REFUNDABLE = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING'];

// 상태 필터 Select 옵션 — '전체' + 전 상태.
export function buildStatusOptions(): { value: string; label: string }[] {
  return [
    { value: '', label: '전체 상태' },
    ...Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v })),
  ];
}
