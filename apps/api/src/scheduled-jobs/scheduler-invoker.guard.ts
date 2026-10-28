import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import {
  getConfigValues,
  resolveSchedulerTriggerSettings,
  type SchedulerTriggerSettings,
} from '../config/runtime-config';

export type SchedulerIdTokenVerifier = (
  idToken: string,
  audience: string,
) => Promise<TokenPayload | undefined>;

export const SCHEDULER_ID_TOKEN_VERIFIER = Symbol('SCHEDULER_ID_TOKEN_VERIFIER');

// Google이 서명한 ID token의 서명·만료·발급자·수신자(audience)를 확인한다.
export function createGoogleIdTokenVerifier(): SchedulerIdTokenVerifier {
  const client = new OAuth2Client();
  return async (idToken, audience) => {
    const ticket = await client.verifyIdToken({ idToken, audience });
    return ticket.getPayload();
  };
}

/**
 * Cloud Scheduler가 정해진 서비스 계정의 OIDC token으로 부른 요청만 통과시킨다.
 * 예약 호출 설정이 없으면(Railway처럼 서버 안 정기 작업을 쓰는 곳) 경로가 없는 것처럼 404를 낸다.
 */
@Injectable()
export class SchedulerInvokerGuard implements CanActivate {
  private readonly logger = new Logger(SchedulerInvokerGuard.name);
  private readonly settings: SchedulerTriggerSettings | null;

  constructor(
    config: ConfigService,
    @Inject(SCHEDULER_ID_TOKEN_VERIFIER) private readonly verify: SchedulerIdTokenVerifier,
  ) {
    this.settings = resolveSchedulerTriggerSettings(getConfigValues(config));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.settings) throw new NotFoundException();

    const request = context
      .switchToHttp()
      .getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const header = request.headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
    if (!match) throw new UnauthorizedException();

    let payload: TokenPayload | undefined;
    try {
      payload = await this.verify(match[1], this.settings.audience);
    } catch (error) {
      // token 내용은 남기지 않는다.
      this.logger.warn(
        `[SchedulerInvoker] token 검증 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException();
    }
    if (payload?.email !== this.settings.invokerEmail || payload.email_verified !== true) {
      this.logger.warn('[SchedulerInvoker] 허용하지 않은 호출 계정입니다.');
      throw new UnauthorizedException();
    }
    return true;
  }
}
