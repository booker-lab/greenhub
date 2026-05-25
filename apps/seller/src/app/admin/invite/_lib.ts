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

// 발급 직후 만료일 긴 표기(년 월 일).
export function formatExpiryLong(expiresAt: string): string {
  return new Date(expiresAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
