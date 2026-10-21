import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

function makeStrategy(user: Record<string, unknown> | null) {
  const firestore = {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: user !== null,
        data: () => user,
      }),
    }),
  };
  const config = { get: jest.fn().mockReturnValue('jwt-secret') };
  return {
    firestore,
    strategy: new JwtStrategy(config as unknown as ConfigService, firestore as never),
  };
}

describe('JwtStrategy driver 승인 경계', () => {
  it('승인된 driver만 현재 권한과 일치하는 JWT 검증을 통과한다', async () => {
    const { strategy } = makeStrategy({
      id: 'driver-1',
      role: 'driver',
      driverApproved: true,
      suspended: false,
    });

    await expect(strategy.validate({ sub: 'driver-1', role: 'driver' })).resolves.toEqual({
      sub: 'driver-1',
      role: 'driver',
    });
  });

  it.each([
    ['승인 전', { id: 'driver-1', role: 'driver', driverApproved: false }],
    ['승인 필드 없음', { id: 'driver-1', role: 'driver' }],
    ['정지됨', { id: 'driver-1', role: 'driver', driverApproved: true, suspended: true }],
    ['역할 불일치', { id: 'driver-1', role: 'consumer', driverApproved: true }],
  ])('%s driver는 API JWT 검증이 거부된다', async (_label, user) => {
    const { strategy } = makeStrategy(user);

    await expect(strategy.validate({ sub: 'driver-1', role: 'driver' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admin의 현재 권한을 다시 읽고 통과시킨다', async () => {
    const { strategy, firestore } = makeStrategy({
      id: 'admin-1',
      role: 'admin',
      suspended: false,
    });

    await expect(strategy.validate({ sub: 'admin-1', role: 'admin' })).resolves.toEqual({
      sub: 'admin-1',
      role: 'admin',
    });
    expect(firestore.doc).toHaveBeenCalledWith('users/admin-1');
  });

  it('현재 consumer 권한과 일치하는 JWT를 통과시킨다', async () => {
    const { strategy } = makeStrategy({
      id: 'consumer-1',
      role: 'consumer',
      storeId: null,
      suspended: false,
    });

    await expect(strategy.validate({ sub: 'consumer-1', role: 'consumer' })).resolves.toEqual({
      sub: 'consumer-1',
      role: 'consumer',
    });
  });

  it.each([
    ['admin 역할 하향', 'admin-1', 'admin', { id: 'admin-1', role: 'consumer' }],
    ['admin 정지', 'admin-1', 'admin', { id: 'admin-1', role: 'admin', suspended: true }],
    ['seller 역할 하향', 'seller-1', 'seller', { id: 'seller-1', role: 'consumer', storeId: 'store-1' }],
    ['seller 정지', 'seller-1', 'seller', { id: 'seller-1', role: 'seller', storeId: 'store-1', suspended: true }],
    ['seller 매장 이동', 'seller-1', 'seller', { id: 'seller-1', role: 'seller', storeId: 'store-2' }],
    ['consumer 정지', 'consumer-1', 'consumer', { id: 'consumer-1', role: 'consumer', suspended: true }],
    ['consumer 역할 변경', 'consumer-1', 'consumer', { id: 'consumer-1', role: 'seller' }],
  ])('%s stale JWT를 거부한다', async (_label, sub, tokenRole, user) => {
    const { strategy } = makeStrategy(user);
    const payload = {
      sub,
      role: tokenRole,
      ...(tokenRole === 'seller' ? { storeId: 'store-1' } : {}),
    } as never;

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('사용자 문서가 없으면 모든 역할의 JWT를 거부한다', async () => {
    const { strategy, firestore } = makeStrategy(null);

    await expect(strategy.validate({ sub: 'consumer-1', role: 'consumer' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(firestore.doc).toHaveBeenCalledWith('users/consumer-1');
  });

  it('현재 사용자 role/storeId를 request.user에 반영한다', async () => {
    const { strategy } = makeStrategy({
      id: 'seller-1',
      role: 'seller',
      storeId: 'store-1',
      suspended: false,
    });

    await expect(
      strategy.validate({ sub: 'seller-1', role: 'seller', storeId: 'store-1' }),
    ).resolves.toEqual({ sub: 'seller-1', role: 'seller', storeId: 'store-1' });
  });
});

describe('JwtStrategy 세션 폐기 시각(sessionsRevokedAt)', () => {
  function revokedAt(millis: number) {
    return { toMillis: () => millis };
  }

  function consumer(extra: Record<string, unknown> = {}) {
    return { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false, ...extra };
  }

  it('탈퇴한 사용자 문서의 access token은 폐기 기록과 관계없이 401로 거부한다', async () => {
    const { strategy } = makeStrategy(consumer({ withdrawnAt: revokedAt(1_000) }));

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', iat: 2_000 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('폐기 기록이 없으면 iat와 관계없이 통과한다', async () => {
    const { strategy } = makeStrategy(consumer());

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', iat: 1_000 }),
    ).resolves.toEqual({ sub: 'consumer-1', role: 'consumer' });
  });

  it('폐기 시각 이전에 발급된 access token은 만료 전이어도 401로 거부한다', async () => {
    const { strategy } = makeStrategy(
      consumer({ sessionsRevokedAt: revokedAt(1_700_000_000_000) }),
    );

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', iat: 1_699_999_999 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('로그아웃과 같은 초에 새로 로그인해 받은 토큰은 통과한다(기록 시각은 초 단위로 내림)', async () => {
    // 로그아웃 시각 1_700_000_000_700ms → 기록 1_700_000_000_000ms. 같은 초의 새 토큰 iat=1_700_000_000.
    const { strategy } = makeStrategy(
      consumer({ sessionsRevokedAt: revokedAt(1_700_000_000_000) }),
    );

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', iat: 1_700_000_000 }),
    ).resolves.toEqual({ sub: 'consumer-1', role: 'consumer' });
    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', iat: 1_700_000_001 }),
    ).resolves.toEqual({ sub: 'consumer-1', role: 'consumer' });
  });

  it.each([
    ['iat 없는 토큰', consumer({ sessionsRevokedAt: revokedAt(1_700_000_000_000) }), undefined],
    ['형식을 알 수 없는 폐기 기록', consumer({ sessionsRevokedAt: '2026-10-12' }), 1_800_000_000],
  ])('%s은 폐기 기록이 있으면 거부한다', async (_label, user, iat) => {
    const { strategy } = makeStrategy(user);

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', iat } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('정지는 폐기 시각보다 먼저 403으로 거부한다(기존 응답 유지)', async () => {
    const { strategy } = makeStrategy(
      consumer({ suspended: true, sessionsRevokedAt: revokedAt(1_700_000_000_000) }),
    );

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', iat: 1_600_000_000 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('JwtStrategy 기기별 세션(sid)', () => {
  function consumer(extra: Record<string, unknown> = {}) {
    return { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false, ...extra };
  }

  it('살아 있는 세션의 access token은 통과하고 request.user에 sid를 넘긴다', async () => {
    const { strategy } = makeStrategy(consumer({ activeSessionIds: ['sid-a', 'sid-b'] }));

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', sid: 'sid-b' }),
    ).resolves.toEqual({ sub: 'consumer-1', role: 'consumer', sid: 'sid-b' });
  });

  it.each([
    ['로그아웃 등으로 목록에서 빠진 세션', consumer({ activeSessionIds: ['sid-b'] }), 'sid-a'],
    ['세션 목록이 없는 사용자', consumer(), 'sid-a'],
    ['형식을 알 수 없는 세션 목록', consumer({ activeSessionIds: 'sid-a' }), 'sid-a'],
    ['문자열이 아닌 sid', consumer({ activeSessionIds: ['1'] }), 1],
  ])('%s의 access token은 만료 전이어도 401로 거부한다', async (_label, user, sid) => {
    const { strategy } = makeStrategy(user);

    await expect(
      strategy.validate({ sub: 'consumer-1', role: 'consumer', sid } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sid 없는 이전 발급 access token은 사용자 단위 검사만 받는다', async () => {
    const { strategy } = makeStrategy(consumer({ activeSessionIds: [] }));

    await expect(strategy.validate({ sub: 'consumer-1', role: 'consumer' })).resolves.toEqual({
      sub: 'consumer-1',
      role: 'consumer',
    });
  });
});
