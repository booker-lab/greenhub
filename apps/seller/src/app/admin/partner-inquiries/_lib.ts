// 입점 문의 화면 표시용 순수 함수.

/** 받은 날짜를 한국 시각 기준으로 보여 준다(서버·브라우저 시간대와 무관). */
export function formatInquiryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
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
