/**
 * 회차 주문의 받는 분 연락처는 휴대폰 번호만 받는다(2026-10-10 결정).
 *
 * 주문·배송 알림톡은 이 번호로 가고, 새벽 배송 중 기사도 이 번호로 연락한다. 집 전화나 잘못 친
 * 번호(예: 00000000)는 알림톡이 실패하고 연락도 닿지 않으므로 주문을 만들기 전에 거절한다.
 * 숫자만 남기고(+82 국가번호는 0으로 바꾼다) 010-1234-5678 꼴로 맞춰 저장한다.
 * 010 번호는 언제나 11자리다. 10자리는 예전 국번(011·016·017·018·019)에만 있으므로
 * 010-123-4567처럼 한 자리 빠진 번호도 여기서 거절한다.
 */
const KOREAN_MOBILE_DIGITS = /^(?:010\d{8}|01[16789]\d{7,8})$/;

export function normalizeKoreanMobilePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('82')) digits = `0${digits.slice(2)}`;
  if (!KOREAN_MOBILE_DIGITS.test(digits)) return null;
  return digits.length === 11
    ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
