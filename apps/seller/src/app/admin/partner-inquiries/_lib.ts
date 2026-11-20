// 입점 문의 화면 표시용 순수 함수.

import { formatAdminDate } from '../_components/adminFormat';

/** 받은 날짜를 어드민 날짜 형식(한국 시각 "2026-10-17")으로 보여 준다. 읽을 수 없으면 빈 문자열. */
export function formatInquiryDate(iso: string): string {
  return formatAdminDate(iso) ?? '';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s()-]+$/;

/**
 * 연락처를 바로 누를 수 있는 링크로 만든다. 이메일이면 mailto:, 숫자 8자리 이상 전화번호면 tel:.
 * 그 밖의 자유 입력(카카오톡 아이디 등)은 링크로 만들지 않는다(null).
 */
export function contactHref(contact: string): string | null {
  const value = contact.trim();
  if (EMAIL.test(value)) return `mailto:${value}`;
  if (PHONE.test(value)) {
    const digits = value.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length >= 8) return `tel:${digits}`;
  }
  return null;
}
