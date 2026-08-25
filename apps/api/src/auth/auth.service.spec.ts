import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as admin from 'firebase-admin';
import * as bcrypt from 'bcrypt';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService } from './auth.service';
import type { KakaoClient } from './kakao.client';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(),
}));

describe('AuthService', () => {
  function makeKakaoLoginService(options: {
    user?: Record<string, unknown>;
    kakaoError?: Error;
  }) {
    const usersQuery = {
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        empty: options.user === undefined,
        docs: options.user ? [{ data: () => options.user }] : [],
      }),
    };
    const userRef = {
      get: jest.fn().mockResolvedValue({
        exists: options.user !== undefined,
        data: () => options.user,
      }),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const refreshTokenRef = { set: jest.fn().mockResolvedValue(undefined) };
    const firestore = {
      collection: jest.fn((path: string) => {
        if (path === 'users') return usersQuery;
        throw new Error(`예상하지 못한 컬렉션 경로: ${path}`);
      }),
      doc: jest.fn((path: string) => {
        if (path.startsWith('users/')) return userRef;
        if (path.startsWith('refreshTokens/')) return refreshTokenRef;
        throw new Error(`예상하지 못한 문서 경로: ${path}`);
      }),
      Timestamp: { now: jest.fn(() => 'now') },
    };
    const jwt = {
      sign: jest.fn((_payload: Record<string, unknown>, options: { secret?: string }) =>
        options.secret === 'access-secret' ? 'access-token' : 'refresh-token',
      ),
      verify: jest.fn(),
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
    const kakaoClient = {
      getUser: jest.fn(
        options.kakaoError
          ? () => {
              throw options.kakaoError ?? new Error('카카오 token 오류');
            }
          : () =>
              Promise.resolve({
                kakaoId: 'verified-kakao',
                email: 'kakao@example.com',
                name: '카카오사용자',
              }),
      ),
    };
    const service = new AuthService(
      firestore as unknown as FirestoreService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      kakaoClient as unknown as KakaoClient,
      audit as unknown as AuditService,
    );
    return { audit, firestore, jwt, kakaoClient, refreshTokenRef, service, userRef, usersQuery };
  }

  describe('kakaoLogin', () => {
    it('클라이언트가 보낸 kakaoId 대신 검증된 카카오 id로 사용자를 조회한다', async () => {
      const { jwt, kakaoClient, service, usersQuery } = makeKakaoLoginService({
        user: { id: 'user-1', role: 'consumer', storeId: null, suspended: false },
      });

      await expect(
        service.kakaoLogin({
          kakaoAccessToken: 'real-kakao-token',
          kakaoId: 'forged-kakao',
          targetRole: 'consumer',
        } as never),
      ).resolves.toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });

      expect(kakaoClient.getUser).toHaveBeenCalledWith('real-kakao-token');
      expect(usersQuery.where).toHaveBeenCalledWith('kakaoId', '==', 'verified-kakao');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', role: 'consumer' }),
        expect.objectContaining({ secret: 'access-secret' }),
      );
    });

    it('카카오 token 검증 실패 시 사용자 조회와 JWT 발급을 하지 않는다', async () => {
      const { firestore, jwt, service } = makeKakaoLoginService({
        kakaoError: new Error('카카오 token 오류'),
      });

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'bad-token', targetRole: 'consumer' }),
      ).rejects.toThrow('카카오 token 오류');
      expect(firestore.collection).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('seller 카카오 신규 생성은 차단한다', async () => {
      const { jwt, service, userRef } = makeKakaoLoginService({});

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'seller' }),
      ).rejects.toMatchObject({ status: 403 });
      expect(userRef.set).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('요청 targetRole과 기존 사용자 role이 맞지 않으면 차단한다', async () => {
      const { audit, jwt, service } = makeKakaoLoginService({
        user: { id: 'seller-1', role: 'seller', storeId: 'store-1', suspended: false },
      });

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' }),
      ).rejects.toMatchObject({ status: 403 });
      expect(audit.log).toHaveBeenCalledWith(
        'auth.kakao.forbidden',
        expect.objectContaining({ userId: 'seller-1' }),
      );
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('정지 사용자는 카카오 로그인에서도 차단한다', async () => {
      const { audit, jwt, service } = makeKakaoLoginService({
        user: { id: 'user-1', role: 'consumer', storeId: null, suspended: true },
      });

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(audit.log).toHaveBeenCalledWith('auth.login.suspended', { userId: 'user-1' });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('공개 driver 가입은 승인 대기 상태로 저장한다', async () => {
      const { service, userRef } = makeKakaoLoginService({});

      await service.register({
        email: 'driver@example.com',
        password: 'password-123',
        name: '신청 기사',
        role: 'driver',
      } as never);

      expect(userRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'driver', driverApproved: false }),
      );
    });

    it('기존 미승인 driver를 카카오 로그인 때 자동 승인하지 않는다', async () => {
      const { service, userRef } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', storeId: null, suspended: false },
      });

      const result = await service.kakaoLogin({
        kakaoAccessToken: 'token',
        targetRole: 'driver',
      });

      expect(result.user).not.toHaveProperty('driverApproved', true);
      expect(userRef.update).not.toHaveBeenCalled();
    });

    it('신규 driver의 카카오 가입도 승인 대기로 저장한다', async () => {
      const { service, userRef } = makeKakaoLoginService({});

      const result = await service.kakaoLogin({
        kakaoAccessToken: 'token',
        targetRole: 'driver',
      });

      expect(result.user).toMatchObject({ role: 'driver', driverApproved: false });
      expect(userRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'driver', driverApproved: false }),
      );
    });
  });

  describe('email login driver approval', () => {
    const password = 'password-123';

    async function makeEmailLoginService(overrides: Record<string, unknown> = {}) {
      return makeKakaoLoginService({
        user: {
          id: 'driver-1',
          email: 'driver@example.com',
          name: '신청 기사',
          role: 'driver',
          storeId: null,
          suspended: false,
          passwordHash: await bcrypt.hash(password, 4),
          ...overrides,
        },
      });
    }

    it.each([
      ['false', { driverApproved: false }],
      ['missing', {}],
    ])('%s approval driver는 token 발급 전에 email login이 거부된다', async (_label, approval) => {
      const { jwt, refreshTokenRef, service } = await makeEmailLoginService(approval);

      await expect(service.login({ email: 'driver@example.com', password })).rejects.toMatchObject({
        status: 403,
      });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it('승인된 driver는 정상적으로 email login하고 access/refresh token을 발급한다', async () => {
      const { jwt, refreshTokenRef, service } = await makeEmailLoginService({
        driverApproved: true,
      });

      const result = await service.login({ email: 'driver@example.com', password });
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user).toMatchObject({ role: 'driver', driverApproved: true });
      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(refreshTokenRef.set).toHaveBeenCalledTimes(1);
    });

    it.each(['consumer', 'seller', 'admin'])('%s email login 정상 경로를 유지한다', async (role) => {
      const { service } = await makeEmailLoginService({ role, driverApproved: undefined });

      const result = await service.login({ email: 'driver@example.com', password });
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user).toMatchObject({ role });
    });

    it('정지된 사용자의 기존 email login 거부를 유지한다', async () => {
      const { jwt, service } = await makeEmailLoginService({
        role: 'consumer',
        suspended: true,
      });

      await expect(service.login({ email: 'driver@example.com', password })).rejects.toMatchObject({
        status: 401,
      });
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });

  describe('getFirebaseToken', () => {
    const firebaseAuth = { createCustomToken: jest.fn() };

    beforeEach(() => {
      jest.clearAllMocks();
      firebaseAuth.createCustomToken.mockResolvedValue('firebase-custom-token');
      (admin.auth as jest.Mock).mockReturnValue(firebaseAuth);
    });

    it('승인된 driver token에는 Rules가 기대하는 true claim을 넣는다', async () => {
      const { service } = makeKakaoLoginService({
        user: {
          id: 'driver-1',
          role: 'driver',
          driverApproved: true,
          suspended: false,
        },
      });

      await expect(service.getFirebaseToken('driver-1', 'driver')).resolves.toBe(
        'firebase-custom-token',
      );
      expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith('driver-1', {
        role: 'driver',
        storeId: null,
        driverApproved: true,
      });
    });

    it.each([
      ['미승인', { id: 'driver-1', role: 'driver', driverApproved: false, suspended: false }],
      ['승인 claim 누락', { id: 'driver-1', role: 'driver', suspended: false }],
      ['역할 불일치', { id: 'driver-1', role: 'consumer', driverApproved: true, suspended: false }],
    ])('%s driver token 발급을 거부한다', async (_label, user) => {
      const { service } = makeKakaoLoginService({ user });

      await expect(service.getFirebaseToken('driver-1', 'driver')).rejects.toMatchObject({
        status: 403,
      });
      expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
    });

    it('정지되거나 존재하지 않는 driver token 발급을 거부한다', async () => {
      const suspended = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: true },
      });
      await expect(suspended.service.getFirebaseToken('driver-1', 'driver')).rejects.toMatchObject({
        status: 401,
      });

      const missing = makeKakaoLoginService({});
      await expect(missing.service.getFirebaseToken('driver-1', 'driver')).rejects.toMatchObject({
        status: 401,
      });
      expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
    });

    it('driver가 아닌 token에는 driverApproved claim을 넣지 않는다', async () => {
      const { service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', suspended: false },
      });

      await service.getFirebaseToken('consumer-1', 'consumer');

      expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith('consumer-1', {
        role: 'consumer',
        storeId: null,
      });
    });

    it('승인 상태 변경은 다음 token 발급에만 반영된다', async () => {
      const user = {
        id: 'driver-1',
        role: 'driver',
        driverApproved: false,
        suspended: false,
      };
      const { service } = makeKakaoLoginService({ user });

      await expect(service.getFirebaseToken('driver-1', 'driver')).rejects.toMatchObject({
        status: 403,
      });
      user.driverApproved = true;
      await expect(service.getFirebaseToken('driver-1', 'driver')).resolves.toBe(
        'firebase-custom-token',
      );
      user.driverApproved = false;
      await expect(service.getFirebaseToken('driver-1', 'driver')).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
