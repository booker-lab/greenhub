import { describe, expect, it } from 'vitest';
import {
  DRIVER_APPLICATION_TICKET_MAX_AGE_SECONDS,
  driverApplicationCookieOptions,
  driverApplicationRedirectPath,
  isDriverApplicationTicket,
  isLoopbackHost,
  readDriverApplicationRejection,
} from './driver-application-ticket';

const TICKET = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkcml2ZXItMSJ9.c2lnbmF0dXJl';
const PENDING_URL = '/login?error=ApprovalPending';

describe('가입 신청 티켓 읽기', () => {
  it('거절 본문에서 티켓과 상태를 읽는다', () => {
    expect(
      readDriverApplicationRejection({
        code: 'DRIVER_APPROVAL_PENDING',
        applicationTicket: TICKET,
        applicationStatus: 'none',
      }),
    ).toEqual({ ticket: TICKET, status: 'none' });
    expect(
      readDriverApplicationRejection({ applicationTicket: TICKET, applicationStatus: 'submitted' }),
    ).toEqual({ ticket: TICKET, status: 'submitted' });
  });

  it.each([
    ['본문 없음', undefined],
    ['티켓 없음(이전 API)', { code: 'DRIVER_APPROVAL_PENDING' }],
    ['모르는 상태', { applicationTicket: TICKET, applicationStatus: 'approved' }],
    ['JWT 모양이 아닌 티켓', { applicationTicket: 'not a jwt', applicationStatus: 'none' }],
    ['쿠키에 넣을 수 없는 문자', { applicationTicket: 'a.b.c;x=1', applicationStatus: 'none' }],
    ['너무 긴 티켓', { applicationTicket: `a.b.${'c'.repeat(3000)}`, applicationStatus: 'none' }],
  ])('%s는 티켓 없이 처리한다', (_label, body) => {
    expect(readDriverApplicationRejection(body)).toBeNull();
  });

  it('티켓 형식은 JWT 세 조각만 받는다', () => {
    expect(isDriverApplicationTicket(TICKET)).toBe(true);
    expect(isDriverApplicationTicket('a.b')).toBe(false);
    expect(isDriverApplicationTicket(42)).toBe(false);
  });
});

describe('로그인 뒤 이동', () => {
  it('신청 전이면 신청 화면, 낸 뒤면 접수 안내로 보낸다', () => {
    expect(driverApplicationRedirectPath('none', PENDING_URL)).toBe('/apply');
    expect(driverApplicationRedirectPath('submitted', PENDING_URL)).toBe(PENDING_URL);
  });
});

describe('가입 신청 티켓 쿠키 속성', () => {
  it('배포(https) 주소에서는 httpOnly·Secure·SameSite=Lax·경로 /apply·30분이다', () => {
    expect(driverApplicationCookieOptions('driver.greenlove.example')).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/apply',
      maxAge: 30 * 60,
    });
    expect(DRIVER_APPLICATION_TICKET_MAX_AGE_SECONDS).toBe(1800);
  });

  it('http로 여는 로컬(localhost)에서만 Secure를 끈다', () => {
    for (const host of [
      'localhost:3003',
      'localhost',
      '127.0.0.1:3003',
      '[::1]:3003',
      'app.localhost',
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(driverApplicationCookieOptions(host).secure).toBe(false);
    }
    for (const host of [null, '', 'localhost.evil.example', '127.0.0.2', 'driver.example.test']) {
      expect(isLoopbackHost(host)).toBe(false);
      expect(driverApplicationCookieOptions(host).secure).toBe(true);
    }
  });
});
