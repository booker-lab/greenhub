import {
  Injectable,
  ConflictException,
  GoneException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { AuditService } from '../common/audit/audit.service';
import type { AddressDto } from './dto/address.dto';
import type { KakaoLoginDto } from './dto/kakao-login.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import { KakaoClient } from './kakao.client';
import type { JwtPayload } from './types/jwt-payload.type';

const USER_ROLES = ['consumer', 'seller', 'driver', 'admin'] as const;

// 기사 앱(targetRole=driver) 카카오 로그인에서 관리자 계정을 거절할 때 붙이는 code.
// 기사 앱 `apps/driver/src/auth.ts`가 같은 값을 읽어 로그인 화면 안내로 바꾼다.
export const KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT = 'KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT';

type AuthoritativeUser = {
  role: JwtPayload['role'];
  storeId: string | null;
};

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

function toTokenStoreId(storeId: string | null): string | undefined {
  return storeId ?? undefined;
}

// 직전 refresh token을 받아 줄 유예. 같은 세션의 동시 갱신과 쿠키 반영 전 재요청만
// 흡수할 만큼 짧게 둔다(2026-09-30 사용자 승인).
export const REFRESH_ROTATION_GRACE_MS = 60_000;

function isWithinRotationGrace(
  stored: Record<string, unknown>,
  presented: string,
  nowMillis: number,
): boolean {
  const rotatedAt = stored['rotatedAt'];
  if (
    typeof stored['token'] !== 'string' ||
    stored['previousToken'] !== presented ||
    typeof rotatedAt !== 'number'
  ) {
    return false;
  }
  const elapsed = nowMillis - rotatedAt;
  return elapsed >= 0 && elapsed <= REFRESH_ROTATION_GRACE_MS;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly kakaoClient: KakaoClient,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    // T2: seller는 inviteToken 필수 — 존재·만료·재사용 검증
    if (dto.role === 'seller') {
      if (!dto.inviteToken) {
        throw new ForbiddenException('판매자 계정은 초대 토큰이 필요합니다.');
      }

      const inviteSnap = await this.firestore.doc(`invites/${dto.inviteToken}`).get();

      if (!inviteSnap.exists) {
        throw new ForbiddenException('유효하지 않은 초대 토큰입니다.');
      }

      const invite = inviteSnap.data()!;

      if ((invite['expiresAt'] as admin.firestore.Timestamp).toMillis() < Date.now()) {
        throw new GoneException('만료된 초대 토큰입니다.');
      }

      if (invite['usedAt'] !== null) {
        throw new ConflictException('이미 사용된 초대 토큰입니다.');
      }
    }

    const existing = await this.firestore
      .collection('users')
      .where('email', '==', dto.email)
      .limit(1)
      .get();

    if (!existing.empty) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const userId = uuidv4();
    const now = this.firestore.Timestamp.now();

    const userDoc = {
      id: userId,
      email: dto.email,
      name: dto.name,
      phone: dto.phone ?? null,
      role: dto.role,
      ...(dto.role === 'driver' ? { driverApproved: false } : {}),
      storeId: null,
      providers: ['email'],
      passwordHash,
      savedAddresses: [],
      fcmToken: null,
      createdAt: now,
      updatedAt: now,
    };

    // T3: seller — 사용자 생성 + 토큰 소비를 단일 트랜잭션으로 묶어 정합성 보장
    if (dto.role === 'seller' && dto.inviteToken) {
      await this.firestore.runTransaction(async (tx) => {
        const inviteRef = this.firestore.doc(`invites/${dto.inviteToken!}`);
        const inviteDoc = await tx.get(inviteRef);

        // 트랜잭션 내 재검증 — 동시 요청으로 인한 경쟁 조건 방지
        if (!inviteDoc.exists || inviteDoc.data()!['usedAt'] !== null) {
          throw new ConflictException('이미 사용된 초대 토큰입니다.');
        }

        tx.set(this.firestore.doc(`users/${userId}`), userDoc);
        tx.update(inviteRef, { usedAt: now, usedBy: userId });
      });
    } else {
      await this.firestore.doc(`users/${userId}`).set(userDoc);
    }

    return { userId };
  }

  async login(dto: LoginDto) {
    const snap = await this.firestore
      .collection('users')
      .where('email', '==', dto.email)
      .limit(1)
      .get();

    if (snap.empty) {
      await this.audit.log('auth.login.failed', {
        detail: { email: dto.email, reason: 'user_not_found' },
      });
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const userData = snap.docs[0].data();
    const valid = await bcrypt.compare(dto.password, userData['passwordHash']);
    if (!valid) {
      await this.audit.log('auth.login.failed', {
        userId: userData['id'],
        detail: { email: dto.email, reason: 'wrong_password' },
      });
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    if (userData['suspended'] === true) {
      await this.audit.log('auth.login.suspended', {
        userId: userData['id'],
        detail: { email: dto.email },
      });
      throw new UnauthorizedException('정지된 계정입니다. 고객센터에 문의해주세요.');
    }

    if (userData['role'] === 'driver' && userData['driverApproved'] !== true) {
      throw new ForbiddenException('승인된 드라이버만 로그인할 수 있습니다.');
    }

    const { accessToken, refreshToken } = await this.issueTokens({
      sub: userData['id'],
      role: userData['role'],
      storeId: userData['storeId'] ?? undefined,
    });

    this.logger.log(`auth.login.success userId=${userData['id']} role=${userData['role']}`);
    const user = this.sanitizeUser(userData);
    return { accessToken, refreshToken, user };
  }

  async getMe(userId: string) {
    const snap = await this.firestore.doc(`users/${userId}`).get();
    if (!snap.exists) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    return this.sanitizeUser(snap.data()!);
  }

  private sanitizeUser(data: Record<string, unknown>) {
    const { passwordHash: _pw, ...user } = data;
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.firestore.doc(`users/${userId}`).update({
      ...dto,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return this.getMe(userId);
  }

  async addAddress(userId: string, dto: AddressDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException();

    const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
    const newAddr = {
      id: uuidv4(),
      label: dto.label,
      address: dto.address,
      addressDetail: dto.addressDetail,
      zipCode: dto.zipCode,
      isDefault: dto.isDefault ?? addresses.length === 0,
    };

    if (newAddr.isDefault) {
      addresses.forEach((a) => (a.isDefault = false));
    }
    addresses.push(newAddr);

    await ref.update({
      savedAddresses: addresses,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return newAddr;
  }

  async updateAddress(userId: string, addressId: string, dto: AddressDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException();

    const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
    const idx = addresses.findIndex((a) => a.id === addressId);
    if (idx === -1) throw new NotFoundException('배송지를 찾을 수 없습니다.');

    if (dto.isDefault) {
      addresses.forEach((a) => (a.isDefault = false));
    }
    addresses[idx] = { ...addresses[idx], ...dto, id: addressId };

    await ref.update({
      savedAddresses: addresses,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return addresses[idx];
  }

  async deleteAddress(userId: string, addressId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException();

    const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
    const filtered = addresses.filter((a) => a.id !== addressId);

    await ref.update({
      savedAddresses: filtered,
      updatedAt: this.firestore.Timestamp.now(),
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException();

    const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
    const idx = addresses.findIndex((a) => a.id === addressId);
    if (idx === -1) throw new NotFoundException('배송지를 찾을 수 없습니다.');

    addresses.forEach((a) => (a.isDefault = false));
    addresses[idx].isDefault = true;

    await ref.update({
      savedAddresses: addresses,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return addresses[idx];
  }

  async kakaoLogin(dto: KakaoLoginDto) {
    const kakaoProfile = await this.kakaoClient.getUser(dto.kakaoAccessToken);
    const snap = await this.firestore
      .collection('users')
      .where('kakaoId', '==', kakaoProfile.kakaoId)
      .limit(1)
      .get();

    let userData: Record<string, unknown>;

    if (!snap.empty) {
      userData = snap.docs[0].data();
    } else {
      if (dto.targetRole === 'seller') {
        throw new ForbiddenException('판매자 계정은 관리자 초대로만 가입할 수 있습니다.');
      }
      const userId = uuidv4();
      const now = this.firestore.Timestamp.now();
      const newRole = dto.targetRole ?? 'consumer';
      userData = {
        id: userId,
        kakaoId: kakaoProfile.kakaoId,
        email: kakaoProfile.email,
        name: kakaoProfile.name,
        phone: null,
        role: newRole,
        ...(newRole === 'driver' ? { driverApproved: false } : {}),
        storeId: null,
        providers: ['kakao'],
        savedAddresses: [],
        fcmToken: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.firestore.doc(`users/${userId}`).set(userData);
    }

    const role = userData['role'] as string;
    const allowedRoles =
      dto.targetRole === 'consumer'
        ? ['consumer', 'admin']
        : dto.targetRole === 'seller'
          ? ['seller', 'admin']
          : dto.targetRole === 'driver'
            ? // 기사 앱은 기사 계정만 받는다(2026-10-04 결정). 관리자는 기사 API를 쓸 수 없다.
              ['driver']
            : ['consumer', 'admin'];
    if (userData['suspended'] === true) {
      await this.audit.log('auth.login.suspended', { userId: userData['id'] as string });
      throw new UnauthorizedException('정지된 계정입니다. 고객센터에 문의해주세요.');
    }

    if (!allowedRoles.includes(role)) {
      await this.audit.log('auth.kakao.forbidden', {
        userId: userData['id'] as string,
        detail: { actualRole: role, targetRole: dto.targetRole },
      });
      // 기사 앱이 일반 거절(승인 대기·다른 역할)과 구분해 "기사 계정으로 로그인" 안내를 보이도록
      // 관리자 거절에만 기계 판독용 code를 붙인다. statusCode·message·error 형태는 그대로다.
      if (dto.targetRole === 'driver' && role === 'admin') {
        throw new ForbiddenException({
          statusCode: 403,
          message: '관리자 계정은 기사 앱을 쓸 수 없습니다.',
          error: 'Forbidden',
          code: KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT,
        });
      }
      throw new ForbiddenException('접근 권한이 없습니다.');
    }

    if (role === 'driver' && userData['driverApproved'] !== true) {
      throw new ForbiddenException('승인된 드라이버만 로그인할 수 있습니다.');
    }

    const { accessToken, refreshToken } = await this.issueTokens({
      sub: userData['id'] as string,
      role: role as JwtPayload['role'],
      storeId: (userData['storeId'] as string) ?? undefined,
    });

    this.logger.log(
      `auth.kakao.success userId=${String(userData['id'])} role=${role} targetRole=${dto.targetRole}`,
    );
    return { accessToken, refreshToken, user: this.sanitizeUser(userData) };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    const currentUser = await this.getAuthoritativeUser(payload.sub);
    if (
      !isStoreIdValue(payload.storeId) ||
      payload.role !== currentUser.role ||
      normalizeStoreId(payload.storeId) !== currentUser.storeId
    ) {
      throw new UnauthorizedException('현재 사용자 권한과 일치하지 않는 리프레시 토큰입니다.');
    }
    const nextPayload: JwtPayload = {
      sub: payload.sub,
      role: currentUser.role,
      storeId: toTokenStoreId(currentUser.storeId),
    };

    // Rotation: 저장된 최신 토큰이면 회전한다. 같은 세션의 동시 요청이나 쿠키 반영 전
    // 재요청으로 직전 토큰이 짧은 유예 안에 다시 오면, 다시 회전하지 않고 현재 토큰을 돌려준다.
    // 그 밖의 토큰은 탈취 후 재사용으로 보고 모든 세션을 무효화한다.
    const tokenRef = this.firestore.doc(`refreshTokens/${payload.sub}`);
    const outcome = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(tokenRef);
      if (!snap.exists) return { kind: 'missing' as const };
      const stored = snap.data() ?? {};
      if (stored['token'] === refreshToken) {
        const tokens = this.signTokens(nextPayload);
        tx.set(tokenRef, {
          token: tokens.refreshToken,
          previousToken: refreshToken,
          rotatedAt: Date.now(),
          updatedAt: this.firestore.Timestamp.now(),
        });
        return { kind: 'issued' as const, tokens };
      }
      if (isWithinRotationGrace(stored, refreshToken, Date.now())) {
        return {
          kind: 'issued' as const,
          tokens: {
            accessToken: this.signAccessToken(nextPayload),
            refreshToken: stored['token'] as string,
          },
        };
      }
      tx.delete(tokenRef);
      return { kind: 'reused' as const };
    });

    if (outcome.kind === 'reused') {
      await this.audit.log('auth.token.stolen', { userId: payload.sub });
    }
    if (outcome.kind !== 'issued') {
      throw new UnauthorizedException('만료된 리프레시 토큰입니다.');
    }
    return outcome.tokens;
  }

  async getSession(user: JwtPayload) {
    // PILOT-AUTH-SAME-DEPLOYMENT-SESSION-REVOCATION-48A.
    // Same-deployment Auth.js session authority: single canonical owner is
    // this API (authoritative user doc + refresh binding). Cookie-local values
    // are never authority. Read-only: no token issuance, rotation, or deletion.
    // Explicit revocation (401/403) covers suspended, missing user, role/store
    // mismatch, driver approval withdrawal, and explicit logout (refresh doc
    // deleted). Transient Firestore/network failures throw other errors and
    // must not be mistaken for revocation by callers.
    const currentUser = await this.getAuthoritativeUser(user.sub);
    if (
      !isStoreIdValue(user.storeId) ||
      user.role !== currentUser.role ||
      normalizeStoreId(user.storeId) !== currentUser.storeId
    ) {
      throw new UnauthorizedException('현재 사용자 권한과 일치하지 않는 세션입니다.');
    }

    const tokenSnap = await this.firestore.doc(`refreshTokens/${user.sub}`).get();
    if (!tokenSnap.exists) {
      throw new UnauthorizedException('폐기된 세션입니다.');
    }

    return {
      sub: user.sub,
      role: currentUser.role,
      ...(currentUser.storeId !== null ? { storeId: currentUser.storeId } : {}),
    };
  }

  async logout(userId: string) {
    await this.firestore.doc(`refreshTokens/${userId}`).delete();
    await this.audit.log('auth.logout', { userId });
  }

  async updateFcmToken(userId: string, fcmToken: string) {
    await this.firestore.doc(`users/${userId}`).update({
      fcmToken,
      updatedAt: this.firestore.Timestamp.now(),
    });
  }

  async getFirebaseToken(userId: string): Promise<string> {
    const currentUser = await this.getAuthoritativeUser(userId);

    return admin.auth().createCustomToken(userId, {
      role: currentUser.role,
      storeId: currentUser.storeId,
      ...(currentUser.role === 'driver' ? { driverApproved: true } : {}),
    });
  }

  private async getAuthoritativeUser(userId: string): Promise<AuthoritativeUser> {
    const userSnap = await this.firestore.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    const user = userSnap.data()!;
    if (user['suspended'] === true) {
      throw new UnauthorizedException('정지된 계정입니다. 고객센터에 문의해주세요.');
    }

    if (!isUserRole(user['role'])) {
      throw new UnauthorizedException('현재 사용자 권한을 확인할 수 없습니다.');
    }

    if (!isStoreIdValue(user['storeId'])) {
      throw new UnauthorizedException('현재 사용자 매장 권한을 확인할 수 없습니다.');
    }

    if (user['role'] === 'driver' && user['driverApproved'] !== true) {
      throw new ForbiddenException('승인된 드라이버만 배송 기능을 사용할 수 있습니다.');
    }

    return {
      role: user['role'],
      storeId: normalizeStoreId(user['storeId']),
    };
  }

  private signAccessToken(payload: JwtPayload) {
    return this.jwt.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '1h'),
    });
  }

  private signTokens(payload: JwtPayload) {
    const accessToken = this.signAccessToken(payload);
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
    });
    return { accessToken, refreshToken };
  }

  private async issueTokens(payload: JwtPayload) {
    const { accessToken, refreshToken } = this.signTokens(payload);

    // Rotation: 최신 refresh token만 유효 (이전 토큰 자동 무효화). 로그인 발급은
    // previousToken을 남기지 않으므로 직전 세션의 회전 유예도 함께 끊는다.
    await this.firestore.doc(`refreshTokens/${payload.sub}`).set({
      token: refreshToken,
      updatedAt: this.firestore.Timestamp.now(),
    });

    return { accessToken, refreshToken };
  }
}
