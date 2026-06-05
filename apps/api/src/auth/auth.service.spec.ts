import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const payload = { sub: 'user-1', role: 'consumer' as const };

  function makeService(options: {
    token?: string;
    user?: Record<string, unknown>;
    userExists?: boolean;
  }) {
    const refreshTokenRef = {
      get: jest.fn().mockResolvedValue({
        exists: options.token !== undefined,
        data: () => ({ token: options.token }),
      }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const userRef = {
      get: jest.fn().mockResolvedValue({
        exists: options.userExists ?? true,
        data: () => options.user ?? {},
      }),
    };
    const firestore = {
      doc: jest.fn((path: string) => {
        if (path === 'refreshTokens/user-1') return refreshTokenRef;
        if (path === 'users/user-1') return userRef;
        throw new Error(`예상하지 못한 문서 경로: ${path}`);
      }),
      Timestamp: { now: jest.fn(() => 'now') },
    };
    const jwt = {
      verify: jest.fn().mockReturnValue(payload),
      sign: jest.fn((_payload: typeof payload, options: { secret?: string }) =>
        options.secret === 'access-secret' ? 'new-access-token' : 'new-refresh-token',
      ),
    };
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          JWT_SECRET: 'access-secret',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_EXPIRES_IN: '1h',
          JWT_REFRESH_EXPIRES_IN: '30d',
        };
        return values[key] ?? fallback;
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };

    const service = new AuthService(
      firestore as unknown as FirestoreService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
    return { audit, firestore, jwt, refreshTokenRef, service, userRef };
  }

  function makeRegisterService(options: {
    precheckInvite?: Record<string, unknown>;
    txInvite?: Record<string, unknown>;
  }) {
    const inviteRef = { path: 'invites/INVITEVALID00001' };
    const userRef = { path: 'users/generated-user' };
    const usersQuery = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true }),
    };
    const tx = {
      get: jest.fn().mockResolvedValue({
        exists: options.txInvite !== undefined,
        data: () => options.txInvite,
      }),
      set: jest.fn(),
      update: jest.fn(),
    };
    const firestore = {
      doc: jest.fn((path: string) => {
        if (path === 'invites/INVITEVALID00001') {
          return {
            ...inviteRef,
            get: jest.fn().mockResolvedValue({
              exists: options.precheckInvite !== undefined,
              data: () => options.precheckInvite,
            }),
          };
        }
        if (path.startsWith('users/')) return userRef;
        throw new Error(`예상하지 못한 문서 경로: ${path}`);
      }),
      collection: jest.fn((path: string) => {
        if (path === 'users') return usersQuery;
        throw new Error(`예상하지 못한 컬렉션 경로: ${path}`);
      }),
      runTransaction: jest.fn((handler) => handler(tx)),
      Timestamp: { now: jest.fn(() => 'now') },
    };
    const jwt = { verify: jest.fn(), sign: jest.fn() };
    const config = { get: jest.fn() };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      firestore as unknown as FirestoreService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
    return { firestore, service, tx };
  }

  function makeHubStaffRegisterService(options: {
    precheckInvite?: Record<string, unknown>;
    txInvite?: Record<string, unknown>;
    hub?: Record<string, unknown>;
  }) {
    const inviteRef = { path: 'hubStaffInvites/HUBSTAFF00000001' };
    const hubRef = { path: 'hubs/hub-1' };
    const userRef = { path: 'users/generated-user' };
    const usersQuery = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true }),
    };
    const tx = {
      get: jest.fn(async (ref: { path: string }) => {
        if (ref.path === inviteRef.path) {
          return {
            exists: options.txInvite !== undefined,
            data: () => options.txInvite,
          };
        }
        if (ref.path === hubRef.path) {
          return {
            exists: options.hub !== undefined,
            data: () => options.hub,
          };
        }
        throw new Error(`예상하지 못한 트랜잭션 문서 경로: ${ref.path}`);
      }),
      set: jest.fn(),
      update: jest.fn(),
    };
    const firestore = {
      doc: jest.fn((path: string) => {
        if (path === inviteRef.path) {
          return {
            ...inviteRef,
            get: jest.fn().mockResolvedValue({
              exists: options.precheckInvite !== undefined,
              data: () => options.precheckInvite,
            }),
          };
        }
        if (path === hubRef.path) return hubRef;
        if (path.startsWith('users/')) return userRef;
        throw new Error(`예상하지 못한 문서 경로: ${path}`);
      }),
      collection: jest.fn((path: string) => {
        if (path === 'users') return usersQuery;
        throw new Error(`예상하지 못한 컬렉션 경로: ${path}`);
      }),
      runTransaction: jest.fn((handler) => handler(tx)),
      Timestamp: { now: jest.fn(() => 'now') },
      FieldValue: { arrayUnion: jest.fn((value: string) => ({ arrayUnion: value })) },
    };
    const jwt = { verify: jest.fn(), sign: jest.fn() };
    const config = { get: jest.fn() };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      firestore as unknown as FirestoreService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
    return { firestore, service, tx };
  }

  describe('refresh', () => {
    it('정지된 사용자의 리프레시 토큰 교환을 차단한다', async () => {
      const { audit, jwt, service } = makeService({
        token: 'old-refresh-token',
        user: { suspended: true },
      });

      await expect(service.refresh('old-refresh-token')).rejects.toMatchObject({
        message: '정지된 계정입니다. 고객센터에 문의해주세요.',
      });
      expect(audit.log).toHaveBeenCalledWith('auth.login.suspended', { userId: 'user-1' });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('정상 사용자는 기존 rotation 검증 후 새 토큰을 발급한다', async () => {
      const { refreshTokenRef, service } = makeService({
        token: 'old-refresh-token',
        user: { suspended: false },
      });

      await expect(service.refresh('old-refresh-token')).resolves.toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      expect(refreshTokenRef.set).toHaveBeenCalledWith({
        token: 'new-refresh-token',
        updatedAt: 'now',
      });
    });

    it('hub_staff refresh는 사용자 문서의 최신 hubId를 토큰 페이로드에 반영한다', async () => {
      const { jwt, service } = makeService({
        token: 'old-refresh-token',
        user: {
          role: 'hub_staff',
          storeId: 'store-1',
          hubId: 'hub-1',
          suspended: false,
        },
      });

      await service.refresh('old-refresh-token');

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          role: 'hub_staff',
          storeId: 'store-1',
          hubId: 'hub-1',
        }),
        expect.objectContaining({ secret: 'access-secret' }),
      );
    });
  });

  describe('register', () => {
    const validInvite = {
      expiresAt: { toMillis: () => Date.now() + 60_000 },
      revokedAt: null,
      usedAt: null,
    };
    const dto = {
      email: 'seller-revoked@example.com',
      password: 'password123',
      name: '테스트셀러',
      role: 'seller' as const,
      inviteToken: 'INVITEVALID00001',
    };

    it('사전 검증에서 취소된 초대 토큰 가입을 차단한다', async () => {
      const { firestore, service } = makeRegisterService({
        precheckInvite: { ...validInvite, revokedAt: 'revoked' },
      });

      await expect(service.register(dto)).rejects.toMatchObject({
        message: '취소된 초대 토큰입니다.',
      });
      expect(firestore.collection).not.toHaveBeenCalledWith('users');
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    });

    it('트랜잭션 재검증에서 취소된 초대 토큰 가입을 차단하고 소비 처리하지 않는다', async () => {
      const { service, tx } = makeRegisterService({
        precheckInvite: validInvite,
        txInvite: { ...validInvite, revokedAt: 'revoked' },
      });

      await expect(service.register(dto)).rejects.toMatchObject({
        message: '취소된 초대 토큰입니다.',
      });
      expect(tx.set).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('거점 스태프 초대 가입은 사용자 생성과 거점 배정을 트랜잭션으로 묶는다', async () => {
      const validInvite = {
        expiresAt: { toMillis: () => Date.now() + 60_000 },
        revokedAt: null,
        usedAt: null,
        storeId: 'store-1',
        hubId: 'hub-1',
      };
      const { firestore, service, tx } = makeHubStaffRegisterService({
        precheckInvite: validInvite,
        txInvite: validInvite,
        hub: { id: 'hub-1', storeId: 'store-1' },
      });

      await expect(
        service.register({
          email: 'staff@example.com',
          password: 'password123',
          name: '거점스태프',
          role: 'hub_staff',
          inviteToken: 'HUBSTAFF00000001',
        }),
      ).resolves.toEqual({ userId: expect.any(String) });

      expect(tx.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^users\//) }),
        expect.objectContaining({
          role: 'hub_staff',
          storeId: 'store-1',
          hubId: 'hub-1',
          hubIds: ['hub-1'],
        }),
      );
      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'hubStaffInvites/HUBSTAFF00000001' }),
        expect.objectContaining({ usedAt: 'now', usedBy: expect.any(String) }),
      );
      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'hubs/hub-1' }),
        expect.objectContaining({
          staffIds: { arrayUnion: expect.any(String) },
          updatedAt: 'now',
        }),
      );
      expect(firestore.FieldValue.arrayUnion).toHaveBeenCalledWith(expect.any(String));
    });
  });
});
