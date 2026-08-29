import { ForbiddenException } from '@nestjs/common';
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
