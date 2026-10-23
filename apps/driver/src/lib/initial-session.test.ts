import type { Session } from 'next-auth';
import { describe, expect, it } from 'vitest';
import { decodeInitialSession, encodeInitialSession } from './initial-session';

const session = {
  user: {
    id: 'driver-1',
    name: '김기사',
    email: 'driver@example.test',
    role: 'driver',
    accessToken: 'access-1',
  },
  expires: '2099-01-01T00:00:00.000Z',
} as Session;

describe('첫 화면 세션 헤더', () => {
  it('한글 이름이 있어도 헤더에 실을 수 있는 값으로 바꾸고 그대로 되돌린다', () => {
    const encoded = encodeInitialSession(session);
    // 헤더 값은 ASCII만 허용한다.
    expect(/^[\x20-\x7e]*$/.test(encoded)).toBe(true);
    expect(() => new Headers({ 'x-test': encoded })).not.toThrow();
    expect(decodeInitialSession(encoded)).toEqual(session);
  });

  it('토큰 오류 표시도 그대로 넘겨 TokenErrorGuard가 예전처럼 로그아웃시킨다', () => {
    const errored = { ...session, user: { ...session.user, accessToken: '', tokenError: true } };
    expect(decodeInitialSession(encodeInitialSession(errored as Session))).toEqual(errored);
  });

  it('값이 없거나 읽을 수 없거나 기사 세션이 아니면 undefined로 돌려 화면이 직접 조회하게 한다', () => {
    for (const value of [
      null,
      undefined,
      '',
      '%E0%A4%A',
      'not-json',
      encodeURIComponent('null'),
      encodeURIComponent('"text"'),
      encodeURIComponent(JSON.stringify({ expires: 'x' })),
      encodeURIComponent(JSON.stringify({ user: 'driver' })),
      encodeURIComponent(JSON.stringify({ user: { role: 'admin' } })),
      encodeURIComponent(JSON.stringify({ user: {} })),
    ]) {
      expect(decodeInitialSession(value)).toBeUndefined();
    }
  });
});
