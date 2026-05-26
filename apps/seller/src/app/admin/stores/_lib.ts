import type { StoreStatus } from '@greenhub/shared';
import type { AdminStore } from '@/hooks/useAdmin';

// 판매자 상태 라벨/색 — stores 탭 표현 SSOT(테이블·카드 공용).
// 키는 shared StoreStatus union(invited|active|archived)과 정확히 일치.
// 호출부(StoresTable)는 `?? store.status` 폴백을 유지해 미래 union 확장 시 안전망 제공.
export const STATUS_LABEL: Record<StoreStatus, string> = {
  active: '운영중',
  invited: '초대됨',
  archived: '정리됨',
};

export const STATUS_COLOR: Record<StoreStatus, string> = {
  active: 'green',
  invited: 'yellow',
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
