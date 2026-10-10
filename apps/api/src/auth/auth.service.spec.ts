import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as admin from 'firebase-admin';
import * as bcrypt from 'bcrypt';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService, KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT } from './auth.service';
import type { KakaoClient } from './kakao.client';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(),
}));

// 실제 bcrypt 동작은 유지하고 compare 호출만 관찰한다.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    compare: jest.fn((data: string, hash: string) => actual.compare(data, hash)),
  };
});

describe('AuthService', () => {
  function makeKakaoLoginService(options: {
    user?: Record<string, unknown>;
    kakaoError?: Error;
    refreshToken?: string;
    refreshRecord?: Record<string, unknown>;
    kakaoIdentity?: Record<string, unknown>;
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
    const refreshRecord =
      options.refreshRecord ??
      (options.refreshToken ? { token: options.refreshToken } : undefined);
    const refreshTokenRef = {
      delete: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({
        exists: refreshRecord !== undefined,
        data: () => refreshRecord,
      }),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const kakaoIdentityRef = {
      get: jest.fn().mockResolvedValue({
        exists: options.kakaoIdentity !== undefined,
        data: () => options.kakaoIdentity,
      }),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const firestore = {
      runTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: (ref: typeof refreshTokenRef) => ref.get(),
          set: (ref: typeof refreshTokenRef, data: unknown) => ref.set(data),
          delete: (ref: typeof refreshTokenRef) => ref.delete(),
        }),
      ),
      collection: jest.fn((path: string) => {
        if (path === 'users') return usersQuery;
        throw new Error(`예상하지 못한 컬렉션 경로: ${path}`);
      }),
      doc: jest.fn((path: string) => {
        if (path.startsWith('users/')) return userRef;
        if (path.startsWith('refreshTokens/')) return refreshTokenRef;
        if (path.startsWith('kakaoIdentities/')) return kakaoIdentityRef;
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
    return {
      audit,
      firestore,
      jwt,
      kakaoClient,
      kakaoIdentityRef,
      refreshTokenRef,
      service,
      userRef,
      usersQuery,
    };
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

    it.each([
      ['false', { driverApproved: false }],
      ['missing', {}],
      ['undefined', { driverApproved: undefined }],
      ['null', { driverApproved: null }],
      ['invalid', { driverApproved: 'true' }],
    ])('기존 %s driver는 토큰 발급 전에 카카오 로그인이 거부된다', async (_label, approval) => {
      const { jwt, refreshTokenRef, service, userRef } = makeKakaoLoginService({
        user: {
          id: 'driver-1',
          role: 'driver',
          storeId: null,
          suspended: false,
          ...approval,
        },
      });

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'driver' }),
      ).rejects.toMatchObject({ status: 403 });

      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
      expect(userRef.set).not.toHaveBeenCalled();
    });

    it('역할 불일치가 driver 승인보다 먼저 적용된다', async () => {
      const { audit, jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: {
          id: 'driver-1',
          role: 'driver',
          driverApproved: false,
          storeId: null,
          suspended: false,
        },
      });

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' }),
      ).rejects.toMatchObject({ status: 403 });

      expect(audit.log).toHaveBeenCalledWith(
        'auth.kakao.forbidden',
        expect.objectContaining({
          userId: 'driver-1',
          detail: { actualRole: 'driver', targetRole: 'consumer' },
        }),
      );
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it('기사 앱(targetRole=driver)은 관리자 계정을 토큰 발급 전에 거절하고 구분 code를 붙인다', async () => {
      const { audit, jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'admin-1', role: 'admin', storeId: null, suspended: false },
      });

      const rejection = service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'driver' });
      await expect(rejection).rejects.toMatchObject({ status: 403 });
      await expect(rejection).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 403,
          error: 'Forbidden',
          code: KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT,
        }),
      });

      expect(audit.log).toHaveBeenCalledWith(
        'auth.kakao.forbidden',
        expect.objectContaining({
          userId: 'admin-1',
          detail: { actualRole: 'admin', targetRole: 'driver' },
        }),
      );
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it.each([
      ['consumer', 'consumer-1'],
      ['seller', 'seller-1'],
    ])('기사 앱의 %s 거절은 관리자 구분 code 없이 기존 거절을 유지한다', async (role, id) => {
      const { jwt, service } = makeKakaoLoginService({
        user: { id, role, storeId: role === 'seller' ? 'store-1' : null, suspended: false },
      });

      const rejection = service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'driver' });
      await expect(rejection).rejects.toMatchObject({ status: 403 });
      await expect(rejection).rejects.not.toMatchObject({
        response: expect.objectContaining({ code: KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT }),
      });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it.each(['consumer', 'seller'] as const)(
      '관리자 계정은 %s 앱 카카오 로그인을 그대로 유지한다',
      async (targetRole) => {
        const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
          user: { id: 'admin-1', role: 'admin', storeId: 'store-1', suspended: false },
        });

        await expect(
          service.kakaoLogin({ kakaoAccessToken: 'token', targetRole }),
        ).resolves.toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });
        expect(jwt.sign).toHaveBeenCalledTimes(2);
        expect(refreshTokenRef.set).toHaveBeenCalledTimes(1);
      },
    );

    it('신규 driver는 승인 대기 document만 생성하고 authenticated session은 만들지 않는다', async () => {
      const { jwt, refreshTokenRef, service, userRef } = makeKakaoLoginService({});

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'driver' }),
      ).rejects.toMatchObject({ status: 403 });

      expect(userRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'driver', driverApproved: false }),
      );
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it('승인된 비정지 driver는 기존 카카오 로그인 토큰 발행을 유지한다', async () => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: {
          id: 'driver-1',
          role: 'driver',
          driverApproved: true,
          storeId: null,
          suspended: false,
        },
      });

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'driver' }),
      ).resolves.toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });

      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ sub: 'driver-1', role: 'driver' }),
        expect.objectContaining({ secret: 'access-secret' }),
      );
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ sub: 'driver-1', role: 'driver' }),
        expect.objectContaining({ secret: 'refresh-secret' }),
      );
      expect(refreshTokenRef.set).toHaveBeenCalledTimes(1);
      expect(jwt.sign.mock.invocationCallOrder[0]).toBeLessThan(
        jwt.sign.mock.invocationCallOrder[1],
      );
      expect(jwt.sign.mock.invocationCallOrder[1]).toBeLessThan(
        refreshTokenRef.set.mock.invocationCallOrder[0],
      );
    });

    it('정지된 승인 driver는 카카오 로그인과 모든 토큰 side effect가 거부된다', async () => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: {
          id: 'driver-1',
          role: 'driver',
          driverApproved: true,
          storeId: null,
          suspended: true,
        },
      });

      await expect(
        service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'driver' }),
      ).rejects.toMatchObject({ status: 401 });

      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it.each([
      ['consumer', 'consumer', null],
      ['seller', 'seller', 'store-1'],
      ['admin', 'consumer', null],
    ])('%s 카카오 로그인에는 driver approval gate 회귀가 없다', async (role, targetRole, storeId) => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: `${role}-1`, role, storeId, suspended: false },
      });

      await expect(
        service.kakaoLogin({
          kakaoAccessToken: 'token',
          targetRole: targetRole as 'consumer' | 'seller' | 'driver',
        }),
      ).resolves.toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });

      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(refreshTokenRef.set).toHaveBeenCalledTimes(1);
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

      await expect(service.getFirebaseToken('driver-1')).resolves.toBe(
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
    ])('%s driver token 발급을 거부한다', async (_label, user) => {
      const { service } = makeKakaoLoginService({ user });

      await expect(service.getFirebaseToken('driver-1')).rejects.toMatchObject({
        status: 403,
      });
      expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
    });

    it('정지되거나 존재하지 않는 driver token 발급을 거부한다', async () => {
      const suspended = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: true },
      });
      await expect(suspended.service.getFirebaseToken('driver-1')).rejects.toMatchObject({
        status: 401,
      });

      const missing = makeKakaoLoginService({});
      await expect(missing.service.getFirebaseToken('driver-1')).rejects.toMatchObject({
        status: 401,
      });
      expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
    });

    it('driver가 아닌 token에는 driverApproved claim을 넣지 않는다', async () => {
      const { service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', suspended: false },
      });

      await service.getFirebaseToken('consumer-1');

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

      await expect(service.getFirebaseToken('driver-1')).rejects.toMatchObject({
        status: 403,
      });
      user.driverApproved = true;
      await expect(service.getFirebaseToken('driver-1')).resolves.toBe(
        'firebase-custom-token',
      );
      user.driverApproved = false;
      await expect(service.getFirebaseToken('driver-1')).rejects.toMatchObject({
        status: 403,
      });
    });

    it('현재 seller role/storeId만 custom claim으로 생성한다', async () => {
      const { service } = makeKakaoLoginService({
        user: {
          id: 'seller-1',
          role: 'seller',
          storeId: 'store-current',
          suspended: false,
        },
      });

      await Reflect.apply(service.getFirebaseToken, service, [
        'seller-1',
        'admin',
        'store-stale',
      ]);

      expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith('seller-1', {
        role: 'seller',
        storeId: 'store-current',
      });
    });

    it('stale admin 입력이 있어도 현재 consumer claim만 생성한다', async () => {
      const { service } = makeKakaoLoginService({
        user: {
          id: 'consumer-1',
          role: 'consumer',
          storeId: null,
          suspended: false,
        },
      });

      await Reflect.apply(service.getFirebaseToken, service, [
        'consumer-1',
        'admin',
        'store-old',
      ]);

      expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith('consumer-1', {
        role: 'consumer',
        storeId: null,
      });
    });

    it.each([
      ['admin', { id: 'admin-1', role: 'admin', suspended: true }],
      ['seller', { id: 'seller-1', role: 'seller', storeId: 'store-1', suspended: true }],
      ['consumer', { id: 'consumer-1', role: 'consumer', suspended: true }],
    ])('%s 정지 사용자의 custom token 발급을 거부한다', async (_label, user) => {
      const { service } = makeKakaoLoginService({ user });

      await expect(service.getFirebaseToken(user.id as string)).rejects.toMatchObject({
        status: 401,
      });
      expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
    });
  });

  describe('refresh current authority', () => {
    it('현재 사용자 권한으로 refresh token을 회전한다', async () => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'seller-1', role: 'seller', storeId: 'store-1', suspended: false },
        refreshToken: 'presented-refresh',
      });
      jwt.verify.mockReturnValue({ sub: 'seller-1', role: 'seller', storeId: 'store-1' });

      await expect(service.refresh('presented-refresh')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        { sub: 'seller-1', role: 'seller', storeId: 'store-1', typ: 'access' },
        expect.objectContaining({ secret: 'access-secret' }),
      );
      expect(refreshTokenRef.set).toHaveBeenCalledTimes(1);
    });

    it('저장된 refresh token 기록이 없으면 재발급하지 않는다', async () => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
      });
      jwt.verify.mockReturnValue({ sub: 'consumer-1', role: 'consumer' });

      await expect(service.refresh('presented-refresh')).rejects.toMatchObject({ status: 401 });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it('저장된 refresh token과 다르면 세션을 무효화하고 재발급하지 않는다', async () => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
        refreshToken: 'stored-refresh',
      });
      jwt.verify.mockReturnValue({ sub: 'consumer-1', role: 'consumer' });

      await expect(service.refresh('presented-refresh')).rejects.toMatchObject({ status: 401 });
      expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it('회전하면 직전 토큰과 회전 시각을 함께 저장한다', async () => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: false },
        refreshToken: 'presented-refresh',
      });
      jwt.verify.mockReturnValue({ sub: 'driver-1', role: 'driver' });

      await service.refresh('presented-refresh');
      expect(refreshTokenRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'refresh-token',
          previousToken: 'presented-refresh',
          rotatedAt: expect.any(Number),
        }),
      );
    });

    it('유예 안에 직전 토큰이 다시 오면 재회전 없이 현재 토큰과 새 access token을 준다', async () => {
      const { audit, jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: false },
        refreshRecord: {
          token: 'current-refresh',
          previousToken: 'previous-refresh',
          rotatedAt: Date.now() - 5_000,
        },
      });
      jwt.verify.mockReturnValue({ sub: 'driver-1', role: 'driver' });

      await expect(service.refresh('previous-refresh')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'current-refresh',
      });
      expect(jwt.sign).toHaveBeenCalledTimes(1);
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
      expect(refreshTokenRef.delete).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it.each([
      ['유예가 지난 직전 토큰', { previousToken: 'previous-refresh', rotatedAt: Date.now() - 61_000 }],
      ['회전 시각이 미래인 기록', { previousToken: 'previous-refresh', rotatedAt: Date.now() + 60_000 }],
      ['직전 토큰 기록 없음(로그인 발급)', {}],
    ])('%s는 재사용으로 보고 세션을 무효화한다', async (_label, record) => {
      const { audit, jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: false },
        refreshRecord: { token: 'current-refresh', ...record },
      });
      jwt.verify.mockReturnValue({ sub: 'driver-1', role: 'driver' });

      await expect(service.refresh('previous-refresh')).rejects.toMatchObject({ status: 401 });
      expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith('auth.token.stolen', { userId: 'driver-1' });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('유예 안이어도 현재 권한이 없으면 토큰을 주지 않는다', async () => {
      const { jwt, service } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: true },
        refreshRecord: {
          token: 'current-refresh',
          previousToken: 'previous-refresh',
          rotatedAt: Date.now() - 5_000,
        },
      });
      jwt.verify.mockReturnValue({ sub: 'driver-1', role: 'driver' });

      await expect(service.refresh('previous-refresh')).rejects.toMatchObject({ status: 401 });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it.each([
      ['사용자 없음', {}, { sub: 'consumer-1', role: 'consumer' }, 401],
      [
        '정지됨',
        { id: 'consumer-1', role: 'consumer', storeId: null, suspended: true },
        { sub: 'consumer-1', role: 'consumer' },
        401,
      ],
      [
        '역할 변경',
        { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
        { sub: 'consumer-1', role: 'admin' },
        401,
      ],
      [
        '매장 변경',
        { id: 'seller-1', role: 'seller', storeId: 'store-current', suspended: false },
        { sub: 'seller-1', role: 'seller', storeId: 'store-old' },
        401,
      ],
      [
        'driver 승인 철회',
        { id: 'driver-1', role: 'driver', driverApproved: false, suspended: false },
        { sub: 'driver-1', role: 'driver' },
        403,
      ],
    ])('%s refresh는 token/session write 없이 거부한다', async (_label, user, payload, status) => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user,
        refreshToken: 'presented-refresh',
      });
      jwt.verify.mockReturnValue(payload);

      await expect(service.refresh('presented-refresh')).rejects.toMatchObject({ status });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });
  });

  describe('login 응답 균일화', () => {
    const password = 'password-123';
    const LOGIN_FAILED = { status: 401, message: '이메일 또는 비밀번호가 올바르지 않습니다.' };
    const compare = bcrypt.compare as unknown as jest.Mock;

    beforeEach(() => {
      compare.mockClear();
    });

    it('없는 계정도 bcrypt 비교를 거친 뒤 같은 401을 준다', async () => {
      const { audit, jwt, service } = makeKakaoLoginService({});

      await expect(service.login({ email: 'nobody@example.com', password })).rejects.toMatchObject(
        LOGIN_FAILED,
      );
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare.mock.calls[0][1]).toMatch(/^\$2b\$12\$/);
      expect(audit.log).toHaveBeenCalledWith('auth.login.failed', {
        detail: { email: 'nobody@example.com', reason: 'user_not_found' },
      });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('비밀번호가 틀린 계정도 같은 401을 준다', async () => {
      const { jwt, service } = makeKakaoLoginService({
        user: {
          id: 'consumer-1',
          email: 'consumer@example.com',
          role: 'consumer',
          passwordHash: await bcrypt.hash(password, 4),
        },
      });

      await expect(
        service.login({ email: 'consumer@example.com', password: 'wrong-password' }),
      ).rejects.toMatchObject(LOGIN_FAILED);
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('비밀번호가 없는 카카오 전용 계정은 500 대신 같은 401을 준다', async () => {
      const { audit, jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'kakao-1', email: 'kakao@example.com', role: 'consumer', kakaoId: '1' },
      });

      await expect(service.login({ email: 'kakao@example.com', password })).rejects.toMatchObject(
        LOGIN_FAILED,
      );
      expect(compare).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith('auth.login.failed', {
        userId: 'kakao-1',
        detail: { email: 'kakao@example.com', reason: 'password_not_set' },
      });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });
  });

  describe('토큰 종류·수신자 claim', () => {
    it('access/refresh 토큰에 typ·aud를 넣고 HS256으로 서명한다', async () => {
      const { jwt, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
      });

      await service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' });

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'consumer-1', typ: 'access' }),
        expect.objectContaining({
          secret: 'access-secret',
          algorithm: 'HS256',
          audience: 'greenhub-api',
        }),
      );
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'consumer-1', typ: 'refresh' }),
        expect.objectContaining({
          secret: 'refresh-secret',
          algorithm: 'HS256',
          audience: 'greenhub-api',
        }),
      );
    });

    it('refresh 검증은 HS256만 받는다', async () => {
      const { jwt, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
        refreshToken: 'presented-refresh',
      });
      jwt.verify.mockReturnValue({ sub: 'consumer-1', role: 'consumer' });

      await service.refresh('presented-refresh');
      expect(jwt.verify).toHaveBeenCalledWith('presented-refresh', {
        secret: 'refresh-secret',
        algorithms: ['HS256'],
      });
    });

    it('typ·aud가 없는 기존 refresh 토큰은 만료 전까지 계속 받는다', async () => {
      const { jwt, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
        refreshToken: 'legacy-refresh',
      });
      jwt.verify.mockReturnValue({ sub: 'consumer-1', role: 'consumer', iat: 1, exp: 2 });

      await expect(service.refresh('legacy-refresh')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });

    it.each([
      ['access 토큰', { typ: 'access', aud: 'greenhub-api' }],
      ['다른 수신자', { typ: 'refresh', aud: 'other-service' }],
      ['알 수 없는 종류', { typ: 'id' }],
    ])('%s는 refresh로 받지 않고 저장소도 건드리지 않는다', async (_label, claims) => {
      const { firestore, jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
        refreshToken: 'presented-refresh',
      });
      jwt.verify.mockReturnValue({ sub: 'consumer-1', role: 'consumer', ...claims });

      await expect(service.refresh('presented-refresh')).rejects.toMatchObject({ status: 401 });
      expect(firestore.doc).not.toHaveBeenCalled();
      expect(firestore.runTransaction).not.toHaveBeenCalled();
      expect(refreshTokenRef.delete).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });

  describe('Firebase 세션 폐기', () => {
    const firebaseAuth = { revokeRefreshTokens: jest.fn() };

    beforeEach(() => {
      jest.clearAllMocks();
      firebaseAuth.revokeRefreshTokens.mockResolvedValue(undefined);
      (admin.auth as jest.Mock).mockReturnValue(firebaseAuth);
    });

    it('logout은 refresh 기록을 지우고 Firebase refresh token도 폐기한다', async () => {
      const { audit, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'seller-1', role: 'seller', storeId: 'store-1' },
        refreshToken: 'stored-refresh',
      });

      await expect(service.logout('seller-1')).resolves.toBeUndefined();
      expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
      expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('seller-1');
      expect(audit.log).toHaveBeenCalledWith('auth.logout', { userId: 'seller-1' });
    });

    it('Firebase 사용자 기록이 없으면(custom token 미사용) logout을 그대로 마친다', async () => {
      firebaseAuth.revokeRefreshTokens.mockRejectedValue(
        Object.assign(new Error('no user'), { code: 'auth/user-not-found' }),
      );
      const { audit, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer' },
      });

      await expect(service.logout('consumer-1')).resolves.toBeUndefined();
      expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith('auth.logout', { userId: 'consumer-1' });
    });

    it('Firebase 폐기가 실패해도 API 세션 폐기는 유지된다', async () => {
      firebaseAuth.revokeRefreshTokens.mockRejectedValue(new Error('firebase unavailable'));
      const { audit, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver' },
      });

      await expect(service.logout('driver-1')).resolves.toBeUndefined();
      expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith('auth.logout', { userId: 'driver-1' });
    });

    it('refresh 재사용을 감지하면 Firebase refresh token도 폐기한다', async () => {
      const { audit, jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: false },
        refreshRecord: { token: 'current-refresh' },
      });
      jwt.verify.mockReturnValue({ sub: 'driver-1', role: 'driver', typ: 'refresh' });

      await expect(service.refresh('stale-refresh')).rejects.toMatchObject({ status: 401 });
      expect(refreshTokenRef.delete).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith('auth.token.stolen', { userId: 'driver-1' });
      expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith('driver-1');
    });

    it('정상 회전에서는 Firebase 세션을 건드리지 않는다', async () => {
      const { jwt, service } = makeKakaoLoginService({
        user: { id: 'driver-1', role: 'driver', driverApproved: true, suspended: false },
        refreshToken: 'presented-refresh',
      });
      jwt.verify.mockReturnValue({ sub: 'driver-1', role: 'driver', typ: 'refresh' });

      await service.refresh('presented-refresh');
      expect(firebaseAuth.revokeRefreshTokens).not.toHaveBeenCalled();
    });
  });

  describe('getSession same-deployment authority', () => {
    it('유효한 session은 현재 권한 projection으로 유지된다', async () => {
      const { service } = makeKakaoLoginService({
        user: { id: 'seller-1', role: 'seller', storeId: 'store-1', suspended: false },
        refreshToken: 'stored-refresh',
      });

      await expect(
        service.getSession({ sub: 'seller-1', role: 'seller', storeId: 'store-1' }),
      ).resolves.toEqual({ sub: 'seller-1', role: 'seller', storeId: 'store-1' });
    });

    it('storeId가 없는 유효 session은 storeId 없이 유지된다', async () => {
      const { service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
        refreshToken: 'stored-refresh',
      });

      await expect(
        service.getSession({ sub: 'consumer-1', role: 'consumer' }),
      ).resolves.toEqual({ sub: 'consumer-1', role: 'consumer' });
    });

    it('explicit logout(refresh 기록 삭제) 후 기존 session 재사용을 거부한다', async () => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user: { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
      });

      await expect(
        service.getSession({ sub: 'consumer-1', role: 'consumer' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });

    it.each([
      ['사용자 없음', {}, { sub: 'consumer-1', role: 'consumer' }, 401],
      [
        '정지됨',
        { id: 'consumer-1', role: 'consumer', storeId: null, suspended: true },
        { sub: 'consumer-1', role: 'consumer' },
        401,
      ],
      [
        '역할 변경',
        { id: 'consumer-1', role: 'consumer', storeId: null, suspended: false },
        { sub: 'consumer-1', role: 'admin' },
        401,
      ],
      [
        '매장 변경',
        { id: 'seller-1', role: 'seller', storeId: 'store-current', suspended: false },
        { sub: 'seller-1', role: 'seller', storeId: 'store-old' },
        401,
      ],
      [
        'driver 승인 철회',
        { id: 'driver-1', role: 'driver', driverApproved: false, suspended: false },
        { sub: 'driver-1', role: 'driver' },
        403,
      ],
    ])('%s session은 write 없이 거부한다', async (_label, user, payload, status) => {
      const { jwt, refreshTokenRef, service } = makeKakaoLoginService({
        user,
        refreshToken: 'stored-refresh',
      });

      await expect(service.getSession(payload as never)).rejects.toMatchObject({ status });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(refreshTokenRef.set).not.toHaveBeenCalled();
    });
  });
});
