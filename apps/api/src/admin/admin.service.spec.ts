import type { FirestoreService } from '../firestore/firestore.service';
import * as admin from 'firebase-admin';
import { AdminService } from './admin.service';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(),
}));

describe('AdminService driver session 보강', () => {
  const firebaseAuth = { revokeRefreshTokens: jest.fn() };

  function makeService(user: Record<string, unknown>, exists = true) {
    const userRef = {
      get: jest.fn().mockResolvedValue({ exists, data: () => user }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const firestore = {
      doc: jest.fn().mockReturnValue(userRef),
      Timestamp: { now: jest.fn(() => 'now') },
    };
    return {
      firestore,
      service: new AdminService(firestore as unknown as FirestoreService, {} as never),
      userRef,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    firebaseAuth.revokeRefreshTokens.mockResolvedValue(undefined);
    (admin.auth as jest.Mock).mockReturnValue(firebaseAuth);
  });

  it('driver 정지 시 Firebase refresh token을 폐기한다', async () => {
    const { service, userRef } = makeService({ id: 'driver-1', role: 'driver' });

    await expect(service.suspendDriver('driver-1', { suspended: true })).resolves.toEqual({
      userId: 'driver-1',
      suspended: true,
    });
    expect(userRef.update).toHaveBeenCalledWith({ suspended: true, updatedAt: 'now' });
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('driver-1');
  });

  it('driver 정지 해제 시 refresh token 폐기를 다시 호출하지 않는다', async () => {
    const { service } = makeService({ id: 'driver-1', role: 'driver' });

    await service.suspendDriver('driver-1', { suspended: false });

    expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});
