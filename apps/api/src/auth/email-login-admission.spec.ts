import { Timestamp } from 'firebase-admin/firestore';
import {
  EMAIL_LOGIN_ALLOWED_UNTIL_FIELD,
  isProductionEmailLoginAdmitted,
} from './email-login-admission';

describe('운영 이메일 로그인 허용 판정', () => {
  const now = Date.UTC(2026, 9, 27, 3, 0, 0);

  it('만료 시각이 지금보다 뒤인 계정만 허용한다', () => {
    expect(
      isProductionEmailLoginAdmitted(
        { [EMAIL_LOGIN_ALLOWED_UNTIL_FIELD]: Timestamp.fromMillis(now + 1) },
        now,
      ),
    ).toBe(true);
    expect(
      isProductionEmailLoginAdmitted(
        { [EMAIL_LOGIN_ALLOWED_UNTIL_FIELD]: new Date(now + 60_000) },
        now,
      ),
    ).toBe(true);
  });

  it.each([
    ['만료 시각이 지금과 같음', Timestamp.fromMillis(now)],
    ['만료 시각이 지남', Timestamp.fromMillis(now - 1)],
    ['필드 없음', undefined],
    ['null', null],
    ['문자열', '2099-01-01T00:00:00.000Z'],
    ['숫자', now + 1],
    ['toMillis가 NaN', { toMillis: () => Number.NaN }],
    ['잘못된 Date', new Date('invalid')],
  ])('%s이면 거부한다', (_label, value) => {
    expect(
      isProductionEmailLoginAdmitted({ [EMAIL_LOGIN_ALLOWED_UNTIL_FIELD]: value }, now),
    ).toBe(false);
  });

  it('사용자 문서가 없거나 현재 시각이 유효하지 않으면 거부한다', () => {
    expect(isProductionEmailLoginAdmitted(undefined, now)).toBe(false);
    expect(
      isProductionEmailLoginAdmitted(
        { [EMAIL_LOGIN_ALLOWED_UNTIL_FIELD]: Timestamp.fromMillis(now + 1) },
        Number.NaN,
      ),
    ).toBe(false);
  });
});
