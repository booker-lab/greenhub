// 어드민 소비자(users) 화면 표시용 순수 함수 (#CL-55 §E T1).
import { toDateStrKST } from '@greenhub/shared';
import { formatAdminDate } from '../_components/adminFormat';

/** 값이 없을 때 표시하는 자리표시자 */
export const EMPTY_FIELD = '—';

/**
 * 가입일 표기(KST, YYYY-MM-DD).
 * API TimestampInterceptor는 ISO 문자열을 내려주고, Firestore raw 직렬화는 `{ _seconds }`.
 * 양쪽 모두 방어적으로 파싱하고, 파싱할 수 없으면 자리표시자를 반환한다.
 */
export function formatJoinedDate(createdAt: unknown): string {
  let date: Date | null = null;
  if (typeof createdAt === 'string' && createdAt.trim() !== '') {
    date = new Date(createdAt);
  } else if (createdAt && typeof createdAt === 'object' && '_seconds' in createdAt) {
    const seconds = (createdAt as { _seconds: unknown })._seconds;
    if (typeof seconds === 'number') date = new Date(seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return EMPTY_FIELD;
  return toDateStrKST(date);
}

/** 전화 표기 — 어드민은 마스킹 없이 전체 표시, 비어 있으면 자리표시자 */
export function formatPhone(phone: string | null | undefined): string {
  const trimmed = phone?.trim();
  return trimmed ? trimmed : EMPTY_FIELD;
}

/**
 * 목록의 전화 가림(design-direction.md §5 어드민 "식별", 2026-11-19 사용자 결정) — 가운데 숫자 묶음을 *로 바꾼다.
 * "010-1234-5678" → "010-****-5678", 하이픈 없는 "01012345678" → "010****5678". 앞 3자리·끝 4자리만 남긴다.
 * 숫자가 8자리 미만이면 가릴 가운데가 없어 그대로 둔다. 전체 번호는 정지 확인창에서만 보여 준다.
 */
export function maskPhone(phone: string): string {
  const value = phone.trim();
  const digits = value.replace(/\D/g, '').length;
  if (digits < 8) return value;
  let seen = 0;
  return value.replace(/\d/g, (d) => {
    seen += 1;
    return seen <= 3 || seen > digits - 4 ? d : '*';
  });
}

/** 정지 메뉴·확인창 라벨 — ⋮ 메뉴·확인창·결과 알림 모두 '정지' / '정지 풀기'로 맞춘다. */
export function suspendActionLabel(currentlySuspended: boolean): string {
  return currentlySuspended ? '정지 풀기' : '정지';
}

/**
 * 정지·정지 풀기 확인창(design-direction.md §5 어드민 "위험 동작 확인창") — 제목 = 동작 + 대상, 한 줄 결과,
 * 대상 정보(이메일·연락처·가입일)로 다른 계정을 고르는 실수를 막는다. 이름이 비면 자리표시자.
 */
export function describeUserSuspendConfirm(target: {
  name: string;
  email: string;
  phone?: string;
  createdAt?: unknown;
  currentlySuspended: boolean;
}): {
  title: string;
  lead: string;
  facts: { label: string; value: string }[];
  confirmLabel: string;
} {
  // 타입은 string이지만 옛 문서에 필드가 없을 수 있어 ?.로 방어한다.
  const name = target.name?.trim() || '이름 없음';
  const facts = [{ label: '이메일', value: target.email?.trim() || EMPTY_FIELD }];
  const phone = target.phone?.trim();
  if (phone) facts.push({ label: '연락처', value: phone });
  const joined = formatAdminDate(target.createdAt);
  if (joined) facts.push({ label: '가입일', value: joined });
  const action = suspendActionLabel(target.currentlySuspended);
  return {
    title: `${name} 님 계정 ${action}`,
    lead: target.currentlySuspended
      ? '정지를 풀면 이 계정으로 다시 앱을 쓸 수 있습니다.'
      : '정지하면 이 계정으로 앱을 쓸 수 없습니다. 정지는 나중에 풀 수 있습니다.',
    facts,
    confirmLabel: `${name} 님 ${action}`,
  };
}
