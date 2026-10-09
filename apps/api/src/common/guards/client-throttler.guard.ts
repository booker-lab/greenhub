import { createHash } from 'node:crypto';
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AuthController } from '../../auth/auth.controller';

const MAX_SUBJECT_LENGTH = 128;
const MAX_EMAIL_LENGTH = 320;
const JWT_ALGORITHMS = ['HS256' as const];

type TrackerRequest = Record<string, any>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function clientIp(req: TrackerRequest): string {
  // trust proxy 설정이 반영된 Express req.ip를 쓴다. X-Forwarded-For를 직접 읽지 않는다.
  if (typeof req.ip === 'string' && req.ip) return req.ip;
  const remote = req.socket?.remoteAddress;
  return typeof remote === 'string' && remote ? remote : 'unknown';
}

function bearerToken(req: TrackerRequest): string | undefined {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

export function normalizedEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return undefined;
  return email;
}

function isHandler(context: ExecutionContext | undefined, handler: unknown): boolean {
  return Boolean(context) && context?.getHandler() === handler;
}

/**
 * 요청 한도 집계 기준(tracker)을 정한다. 한도 값 자체는 ThrottlerModule·@Throttle이 소유한다.
 *
 * - 서명 검증된 access token이 있으면 사용자(`sub`) 단위로 집계한다.
 * - `/auth/refresh`는 서명 검증된 refresh token의 `sub` 단위로 집계한다.
 * - `/auth/login`은 클라이언트 IP + 정규화한 이메일 해시 단위로 집계해, 서버 간 호출처럼
 *   같은 IP를 공유하는 사용자들이 하나의 버킷에 묶이지 않게 한다.
 * - 그 밖에는 trust proxy 기준 클라이언트 IP로 집계한다.
 *
 * 검증되지 않은 토큰은 절대 사용자 키로 쓰지 않고 IP 집계로 돌아간다.
 */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(
    req: TrackerRequest,
    context?: ExecutionContext,
  ): Promise<string> {
    const ip = clientIp(req);

    if (isHandler(context, AuthController.prototype.login)) {
      const email = normalizedEmail(req.body?.email);
      if (email) return `login:${ip}:${sha256(email)}`;
      return `ip:${ip}`;
    }

    if (isHandler(context, AuthController.prototype.refresh)) {
      const sub = this.verifiedSubject(req.body?.refreshToken, 'JWT_REFRESH_SECRET');
      return sub ? `user:${sub}` : `ip:${ip}`;
    }

    const sub = this.verifiedSubject(bearerToken(req), 'JWT_SECRET');
    return sub ? `user:${sub}` : `ip:${ip}`;
  }

  private verifiedSubject(
    token: unknown,
    secretKey: 'JWT_SECRET' | 'JWT_REFRESH_SECRET',
  ): string | undefined {
    if (typeof token !== 'string' || !token) return undefined;
    const secret = this.config.get<string>(secretKey);
    if (typeof secret !== 'string' || !secret) return undefined;

    try {
      const payload = this.jwt.verify<{ sub?: unknown }>(token, {
        secret,
        algorithms: JWT_ALGORITHMS,
      });
      const sub = payload?.sub;
      if (typeof sub !== 'string' || !sub || sub.length > MAX_SUBJECT_LENGTH) return undefined;
      return sub;
    } catch {
      return undefined;
    }
  }
}
