import type { InviteToken } from '@/hooks/useAdmin';

// 초대 토큰 상태(사용됨/만료/유효) 판정 — 테이블·카드 공용(중복 제거).
export interface InviteStatus {
  label: string;
  color: 'gray' | 'red' | 'green';
  expDate: Date | null;
}

export function inviteStatus(inv: InviteToken): InviteStatus {
  const isUsed = !!inv.usedAt;
  const expDate = inv.expiresAt ? new Date(inv.expiresAt) : null;
  const isExpired = expDate ? expDate < new Date() : false;
  return {
    label: isUsed ? '사용됨' : isExpired ? '만료' : '유효',
    color: isUsed ? 'gray' : isExpired ? 'red' : 'green',
    expDate,
  };
}

// 만료일 짧은 표기(ko-KR) — 내역 행 공용.
export function formatExpiry(expDate: Date | null): string {
  return expDate ? expDate.toLocaleDateString('ko-KR') : '-';
}

// 초대 이력 read state — 조회 실패와 성공-empty의 구조적 구분.
// useAdminInvite는 error/reload를 노출하지만 화면이 이를 소비하지 않으면
// 조회 실패가 빈 내역("발급된 토큰이 없습니다.")으로 collapse된다.
// 분기 우선순위(loading > error > empty > results)를 순수 함수로 고정한다.
export type AdminInviteReadState = 'LOADING' | 'FETCH_ERROR' | 'EMPTY' | 'HAS_RESULTS';

export function getAdminInviteReadState(args: {
  loading: boolean;
  error: string | null;
  invites: readonly unknown[];
}): AdminInviteReadState {
  if (args.loading) return 'LOADING';
  if (args.error !== null) return 'FETCH_ERROR';
  if (args.invites.length === 0) return 'EMPTY';
  return 'HAS_RESULTS';
}

// 발급 직후 만료일 긴 표기(년 월 일).
export function formatExpiryLong(expiresAt: string): string {
  return new Date(expiresAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
