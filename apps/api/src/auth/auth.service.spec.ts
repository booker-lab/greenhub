import { AuthService } from './auth.service';
import type { AuditService } from '../common/audit/audit.service';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { FirestoreService } from '../firestore/firestore.service';

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
  });
});
