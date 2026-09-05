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
    refreshToken?: string;
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
    const refreshTokenRef = {
      delete: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({
        exists: options.refreshToken !== undefined,
        data: () => (options.refreshToken ? { token: options.refreshToken } : undefined),
      }),
      set: jest.fn().mockResolvedValue(undefined),
    };
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
        { sub: 'seller-1', role: 'seller', storeId: 'store-1' },
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
});
