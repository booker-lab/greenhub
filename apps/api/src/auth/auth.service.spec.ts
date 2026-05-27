import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { AuthService } from './auth.service';

describe('AuthService.refresh', () => {
  const payload = { sub: 'consumer-1', role: 'consumer' as const };
  const tokenRef = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  };
  const userRef = {
    get: jest.fn(),
  };
  const firestore = {
    doc: jest.fn((path: string) => (path.startsWith('refreshTokens/') ? tokenRef : userRef)),
    Timestamp: { now: jest.fn(() => 'now') },
  };
  const jwt = {
    verify: jest.fn(),
    sign: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => fallback ?? `${key}-value`),
  };
  const audit = {
    log: jest.fn(),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue(payload);
    tokenRef.get.mockResolvedValue({ exists: true, data: () => ({ token: 'refresh-token' }) });
    tokenRef.set.mockResolvedValue(undefined);
    userRef.get.mockResolvedValue({ exists: true, data: () => ({ suspended: false }) });
    audit.log.mockResolvedValue(undefined);
    service = new AuthService(
      firestore as unknown as FirestoreService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
  });

  it('rejects token refresh for a suspended user', async () => {
    userRef.get.mockResolvedValue({ exists: true, data: () => ({ suspended: true }) });

    let rejected: unknown;
    try {
      await service.refresh('refresh-token');
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(UnauthorizedException);
    expect((rejected as Error).message).toBe('정지된 계정입니다. 고객센터에 문의해주세요.');

    expect(firestore.doc).toHaveBeenCalledWith('users/consumer-1');
    expect(audit.log).toHaveBeenCalledWith('auth.login.suspended', { userId: 'consumer-1' });
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(tokenRef.set).not.toHaveBeenCalled();
  });

  it('continues issuing rotated tokens for an active user', async () => {
    jwt.sign.mockReturnValueOnce('new-access-token').mockReturnValueOnce('new-refresh-token');

    await expect(service.refresh('refresh-token')).resolves.toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });

    expect(userRef.get).toHaveBeenCalledTimes(1);
    expect(audit.log).not.toHaveBeenCalledWith('auth.login.suspended', expect.anything());
    expect(tokenRef.set).toHaveBeenCalledWith({
      token: 'new-refresh-token',
      updatedAt: 'now',
    });
  });
});
