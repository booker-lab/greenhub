import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { FirestoreService } from '../../firestore/firestore.service';
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
  it('승인된 driver만 JWT 검증을 통과한다', async () => {
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

  it('driver가 아닌 역할은 승인 조회 없이 통과한다', async () => {
    const { strategy, firestore } = makeStrategy(null);

    await expect(strategy.validate({ sub: 'consumer-1', role: 'consumer' })).resolves.toEqual({
      sub: 'consumer-1',
      role: 'consumer',
    });
    expect(firestore.doc).not.toHaveBeenCalled();
  });
});
