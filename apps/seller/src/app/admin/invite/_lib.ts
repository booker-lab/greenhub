import { toDateTimeStrKST } from '@greenhub/shared';
import type { InviteToken } from '@/hooks/useAdmin';

// 초대 토큰 상태(사용됨/만료/유효) 판정 — 테이블·카드 공용(중복 제거).
export interface InviteStatus {
  label: string;
  color: 'gray' | 'red' | 'green' | 'orange';
  expDate: Date | null;
}

export function inviteStatus(inv: InviteToken): InviteStatus {
  const isRolledBack = !!inv.sellerRollbackAt;
  const isUsed = !!inv.usedAt;
  const isRevoked = !!inv.revokedAt;
  const expDate = inv.expiresAt ? new Date(inv.expiresAt) : null;
  const isExpired = expDate ? expDate < new Date() : false;
  // 부채: 초대 상태 색상은 디자인 토큰 SSOT 도입 전까지 Mantine 색상명으로 유지한다.
  if (isRolledBack) return { label: '되돌림', color: 'orange', expDate };
  if (isRevoked) return { label: '취소됨', color: 'orange', expDate };
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

// 초대 내역 일시 표기(MM-DD HH:mm, KST) — 테이블·카드 공용.
export function formatInviteDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : toDateTimeStrKST(date);
}
