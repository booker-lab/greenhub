import type { InviteRevokeOutcome, InviteToken } from '@/hooks/useAdmin';

// 초대 토큰 상태(취소됨/사용됨/만료/유효) 판정 — 테이블·카드 공용(중복 제거).
// 우선순위는 서버 취소 판정(revokedAt > usedAt > 만료)과 같다.
export interface InviteStatus {
  label: string;
  color: 'gray' | 'red' | 'brand' | 'orange';
  expDate: Date | null;
  /** 취소 버튼 노출 여부 — 유효(미사용·미만료·미취소) 상태만 true. */
  revocable: boolean;
}

export function inviteStatus(inv: InviteToken, now: Date = new Date()): InviteStatus {
  const isRevoked = !!inv.revokedAt;
  const isUsed = !!inv.usedAt;
  const expDate = inv.expiresAt ? new Date(inv.expiresAt) : null;
  const isExpired = expDate ? expDate < now : false;
  if (isRevoked) return { label: '취소됨', color: 'orange', expDate, revocable: false };
  if (isUsed) return { label: '사용됨', color: 'gray', expDate, revocable: false };
  if (isExpired) return { label: '만료', color: 'red', expDate, revocable: false };
  return { label: '유효', color: 'brand', expDate, revocable: true };
}

// 초대 취소 결과 안내 — 409 reason·404를 사용자 문구로 옮긴다.
// null이면 별도 안내 없이 목록 갱신(배지 변경)으로 결과를 보여 준다.
export interface InviteRevokeNotice {
  color: 'red' | 'yellow';
  title: string;
  message: string;
  /** 화면 목록이 서버 상태와 어긋났을 수 있어 다시 조회해야 하는지. */
  needsReload: boolean;
}

const INVITE_REVOKE_REJECTED_TITLE = '초대를 취소하지 못했어요';

function inviteConflictMessage(reason: string | null): string {
  switch (reason) {
    case 'already_revoked':
      return '이미 취소된 초대예요.';
    case 'already_used':
      return '이미 사용된 초대라 취소할 수 없어요.';
    case 'expired':
      return '만료된 초대라 취소할 수 없어요.';
    default:
      return '초대 상태가 바뀌어 취소할 수 없어요. 목록을 다시 확인해 주세요.';
  }
}

export function describeInviteRevokeOutcome(
  outcome: InviteRevokeOutcome,
): InviteRevokeNotice | null {
  if (outcome.kind === 'confirmed') {
    if (outcome.reconciled) return null;
    return {
      color: 'yellow',
      title: '초대는 취소됐지만 목록을 불러오지 못했어요',
      message: `${outcome.readError}. 다시 조회해 최신 상태를 확인해 주세요. 같은 초대를 다시 취소하지 않아도 돼요.`,
      needsReload: false,
    };
  }
  if (outcome.kind === 'unknown') {
    return {
      color: 'yellow',
      title: '초대 취소 결과를 확인하지 못했어요',
      message: '요청이 처리됐는지 알 수 없어요. 목록에서 상태를 먼저 확인해 주세요.',
      needsReload: true,
    };
  }
  if (outcome.status === 404) {
    return {
      color: 'red',
      title: INVITE_REVOKE_REJECTED_TITLE,
      message: '초대를 찾을 수 없어요. 목록을 다시 확인해 주세요.',
      needsReload: true,
    };
  }
  if (outcome.status === 409) {
    return {
      color: 'red',
      title: INVITE_REVOKE_REJECTED_TITLE,
      message: inviteConflictMessage(outcome.reason),
      needsReload: true,
    };
  }
  return {
    color: 'red',
    title: INVITE_REVOKE_REJECTED_TITLE,
    message: outcome.message,
    needsReload: false,
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

// 받는 사람 이메일(필수) 입력 판정. 형식이 맞으면 앞뒤 공백을 뺀 값, 비었거나 형식이 틀리면 오류 문구.
// 최종 형식 검사와 정규화(소문자)는 서버가 한다. 여기서는 명백히 잘못된 입력만 요청 전에 막는다.
export const INVITE_RECIPIENT_EMAIL_MAX_LENGTH = 254;
const INVITE_RECIPIENT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteRecipientEmailInput = { ok: true; value: string } | { ok: false; error: string };

export function parseInviteRecipientEmail(input: string): InviteRecipientEmailInput {
  const value = input.trim();
  if (value === '') return { ok: false, error: '받는 사람 이메일을 입력해 주세요.' };
  if (
    value.length > INVITE_RECIPIENT_EMAIL_MAX_LENGTH ||
    !INVITE_RECIPIENT_EMAIL_PATTERN.test(value)
  ) {
    return { ok: false, error: '이메일 형식이 올바르지 않아요.' };
  }
  return { ok: true, value };
}

// 발급 직후 만료일 긴 표기(년 월 일).
export function formatExpiryLong(expiresAt: string): string {
  return new Date(expiresAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
