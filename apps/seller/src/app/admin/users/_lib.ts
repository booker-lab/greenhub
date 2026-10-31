// 어드민 소비자(users) 화면 표시용 순수 함수 (#CL-55 §E T1).
import { toDateStrKST } from '@greenhub/shared';
import type { ConfirmColor } from '@/components/ConfirmModal';

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

/** 정지 버튼·확인창 라벨 — 표·카드·확인창 모두 '정지' / '정지 해제'로 맞춘다. */
export function suspendActionLabel(currentlySuspended: boolean): string {
  return currentlySuspended ? '정지 해제' : '정지';
}

/** 정지·정지 해제 확인창 — 대상(이름·이메일)을 보여 줘 다른 계정을 고르는 실수를 막는다. */
export function describeUserSuspendConfirm(target: {
  name: string;
  email: string;
  currentlySuspended: boolean;
}): { title: string; message: string; confirmLabel: string; confirmColor: ConfirmColor } {
  // 타입은 string이지만 옛 문서에 필드가 없을 수 있어 ?.로 방어한다.
  const who = `${target.name?.trim() || EMPTY_FIELD} (${target.email?.trim() || EMPTY_FIELD})`;
  if (target.currentlySuspended) {
    return {
      title: '계정 정지 해제',
      message: `${who}\n이 계정의 정지를 해제하시겠습니까?`,
      confirmLabel: suspendActionLabel(true),
      confirmColor: 'brand',
    };
  }
  return {
    title: '계정 정지',
    message: `${who}\n이 계정을 정지하시겠습니까?`,
    confirmLabel: suspendActionLabel(false),
    confirmColor: 'red',
  };
}
