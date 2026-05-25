import type { AdminStore } from '@/hooks/useAdmin';

// 판매자 상태 라벨/색 — stores 탭 표현 SSOT(테이블·카드 공용).
// shared StoreStatus는 archived 미포함이라 어드민 표시는 로컬 맵으로 둔다.
export const STATUS_LABEL: Record<string, string> = {
  active: '운영중',
  invited: '초대됨',
  suspended: '정지',
  archived: '정리됨',
};

export const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  invited: 'yellow',
  suspended: 'gray',
  archived: 'gray',
};

// 평소엔 archived 숨김, 토글 시 전체 표시.
export function filterVisible(stores: AdminStore[], showArchived: boolean): AdminStore[] {
  return showArchived ? stores : stores.filter((s) => s.status !== 'archived');
}

// 수수료율 표시 문자열 — 미설정 시 '기본'.
export function formatRate(rate: number | undefined): string {
  return rate !== undefined ? `${(rate * 100).toFixed(1)}%` : '기본';
}
