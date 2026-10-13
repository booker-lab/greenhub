/**
 * 회차 주문의 받는 분 연락처는 휴대폰 번호만 받는다(2026-10-10 결정).
 *
 * API `apps/api/src/orders/_lib/korean-mobile-phone.ts`와 같은 규칙으로 결제 전에 막아,
 * 결제창을 띄운 뒤 서버 400으로 되돌아오지 않게 한다. 서버 검사가 최종 기준이다.
 */
const KOREAN_MOBILE_DIGITS = /^(?:010\d{8}|01[16789]\d{7,8})$/;

export const ROUND_DELIVERY_PHONE_ERROR =
  '받는 분 휴대폰 번호를 확인해 주세요. 휴대폰 번호만 받을 수 있어요(예: 010-1234-5678).';

export function isKoreanMobilePhone(value: string): boolean {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('82')) digits = `0${digits.slice(2)}`;
  return KOREAN_MOBILE_DIGITS.test(digits);
}
