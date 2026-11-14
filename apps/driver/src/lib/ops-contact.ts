/**
 * 기사 앱이 안내하는 운영 연락처(2026-11-08 사용자 결정: 새 설정값을 만들지 않고 고객센터 번호를 같이 쓴다).
 * 소비자 앱 `apps/consumer/src/lib/publicBusinessInfo.ts`의 `phone`·`phoneHref`와 같은 값이다.
 * 앱 간 import 없이 옮긴 값이므로 번호가 바뀌면 함께 바꾼다(`ops-contact.test.mjs`가 어긋남을 잡는다).
 * 기사 전용 번호가 생기면 이 파일만 바꾼다.
 */
export const DRIVER_OPS_CONTACT = {
  label: '운영팀',
  phone: '010-4452-2104',
  phoneHref: 'tel:01044522104',
  hours: '09:00~18:00 (점심시간 12:00~13:00)',
} as const;
