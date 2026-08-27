import { ForbiddenException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { FirestoreService } from '../../firestore/firestore.service';
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
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
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

    const storeId = normalizeStoreId(user?.['storeId']);
    return {
      sub: payload.sub,
      role: currentRole,
      ...(storeId !== null ? { storeId } : {}),
    };
  }
}
