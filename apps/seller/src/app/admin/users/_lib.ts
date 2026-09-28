// 어드민 소비자(users) 화면 표시용 순수 함수 (#CL-55 §E T1).
import { toDateStrKST } from '@greenhub/shared';

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
