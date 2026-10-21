import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { FirestoreService } from '../../firestore/firestore.service';
import { WITHDRAWN_ACCOUNT_MESSAGE, isWithdrawnUser } from '../account-withdrawal';
import { ACTIVE_SESSION_IDS_FIELD } from '../refresh-sessions';
import {
  isActiveAccessSession,
  isIssuedBeforeSessionRevocation,
  SESSIONS_REVOKED_AT_FIELD,
} from '../session-revocation';
import { hasExpectedTokenClaims, JWT_ALGORITHM } from '../token-claims';
import { JwtPayload } from '../types/jwt-payload.type';

const USER_ROLES = ['consumer', 'seller', 'driver', 'admin'] as const;

function isUserRole(value: unknown): value is JwtPayload['role'] {
  return typeof value === 'string' && USER_ROLES.includes(value as JwtPayload['role']);
}

function isStoreIdValue(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function normalizeStoreId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly firestore: FirestoreService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
      algorithms: [JWT_ALGORITHM],
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // refresh 등 다른 종류의 토큰이나 다른 수신자의 토큰은 사용자 조회 전에 거부한다.
    if (!hasExpectedTokenClaims(payload, 'access')) {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }

    const userSnap = await this.firestore.doc(`users/${payload.sub}`).get();
    const user = userSnap.data();
    const currentRole = user?.['role'];

    if (
      !userSnap.exists ||
      !isUserRole(currentRole) ||
      !isUserRole(payload.role) ||
      !isStoreIdValue(payload.storeId) ||
      !isStoreIdValue(user?.['storeId']) ||
      user?.['suspended'] === true ||
      payload.role !== currentRole ||
      normalizeStoreId(payload.storeId) !== normalizeStoreId(user?.['storeId']) ||
      (currentRole === 'driver' && user?.['driverApproved'] !== true)
    ) {
      throw new ForbiddenException('현재 사용자 권한과 일치하지 않는 인증 토큰입니다.');
    }

    // 탈퇴한 사용자 문서의 토큰은 세션 폐기 기록과 별개로 거부한다.
    if (isWithdrawnUser(user)) {
      throw new UnauthorizedException(WITHDRAWN_ACCOUNT_MESSAGE);
    }

    // 로그아웃·정지로 세션을 폐기한 시각 이전에 발급된 토큰은 만료 전이어도 받지 않는다.
    if (isIssuedBeforeSessionRevocation(payload.iat, user?.[SESSIONS_REVOKED_AT_FIELD])) {
      throw new UnauthorizedException('폐기된 세션의 인증 토큰입니다.');
    }

    // 기기별 세션: 로그아웃 등으로 끝난 세션의 토큰은 같은 사용자 문서의 목록으로 거부한다
    // (추가 읽기 없음). `sid`가 없는 이전 발급 토큰은 위 사용자 단위 검사만 받고 만료(최대 1시간)까지 남는다.
    if (
      payload.sid !== undefined &&
      !isActiveAccessSession(payload.sid, user?.[ACTIVE_SESSION_IDS_FIELD])
    ) {
      throw new UnauthorizedException('폐기된 세션의 인증 토큰입니다.');
    }

    const storeId = normalizeStoreId(user?.['storeId']);
    return {
      sub: payload.sub,
      role: currentRole,
      ...(storeId !== null ? { storeId } : {}),
      ...(payload.sid !== undefined ? { sid: payload.sid } : {}),
    };
  }
}
