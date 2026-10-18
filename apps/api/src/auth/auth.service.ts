import {
  BadRequestException,
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
import { getConfigValues, isProductionRuntime } from '../config/runtime-config';
import * as bcrypt from 'bcrypt';
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { FirestoreService } from '../firestore/firestore.service';
import { AuditService } from '../common/audit/audit.service';
import {
  INVITE_RECIPIENT_MISMATCH_MESSAGE,
  INVITE_REVOKED_MESSAGE,
  assertInviteTokenFormat,
  inviteConflict,
} from './invite-conflict';
import type { AddressDto } from './dto/address.dto';
import type { KakaoLoginDto } from './dto/kakao-login.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import { emailIdentityKey, normalizeEmail } from './email-identity';
import { KakaoClient } from './kakao.client';
import {
  hashRefreshToken,
  isHashedRefreshTokenRecord,
  matchesStoredRefreshToken,
  openRotatedRefreshToken,
  sealRotatedRefreshToken,
} from './refresh-token-store';
import {
  ACTIVE_SESSION_IDS_FIELD,
  type RefreshSessions,
  addRefreshSession,
  isSessionId,
  readRefreshSessions,
} from './refresh-sessions';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  type TokenType,
  hasExpectedTokenClaims,
} from './token-claims';
import {
  SESSIONS_REVOKED_AT_FIELD,
  revokeFirebaseSessions,
  sessionsRevokedAtMillis,
} from './session-revocation';
import type { JwtPayload } from './types/jwt-payload.type';

const USER_ROLES = ['consumer', 'seller', 'driver', 'admin'] as const;

// 기사 앱(targetRole=driver) 카카오 로그인에서 관리자 계정을 거절할 때 붙이는 code.
// 기사 앱 `apps/driver/src/auth.ts`가 같은 값을 읽어 로그인 화면 안내로 바꾼다.
export const KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT = 'KAKAO_LOGIN_DRIVER_APP_ADMIN_ACCOUNT';

// 계정이 없거나 비밀번호가 없는 계정의 로그인도 실제 계정과 같은 비용(cost 12)의 bcrypt 비교를
// 거치게 하는 고정 해시. 어떤 비밀번호와도 일치하지 않는 무작위 값으로 만들었다.
const DUMMY_PASSWORD_HASH = '$2b$12$kXNeYjWNPfuITzHstqiwSOrcnNfjK8UxQARUTuW1gPuNecbN11Dt.';

const LOGIN_FAILED_MESSAGE = '이메일 또는 비밀번호가 올바르지 않습니다.';
const EMAIL_IN_USE_MESSAGE = '이미 사용 중인 이메일입니다.';

// 한 사용자가 저장할 수 있는 배송지 수.
export const SAVED_ADDRESS_MAX_COUNT = 20;

// Firestore gRPC ALREADY_EXISTS(트랜잭션의 create가 이미 있는 문서를 만나면 커밋에서 실패).
const FIRESTORE_ALREADY_EXISTS = 6;

// 이메일 연결 문서를 다른 가입 요청이 먼저 만들어 커밋이 실패하면 이메일 중복으로 응답한다.
function rethrowEmailIdentityConflict(error: unknown): never {
  if ((error as { code?: unknown })?.code === FIRESTORE_ALREADY_EXISTS) {
    throw new ConflictException(EMAIL_IN_USE_MESSAGE);
  }
  throw error;
}

// 판매자 가입에 쓸 수 있는 초대인지 판정한다. 사전 검사와 가입 트랜잭션이 같은 순서
// (취소 > 만료 > 사용 > 받는 사람)로 판정해, 사전 검사 뒤 상태가 바뀌어도 트랜잭션 안에서 같은 응답으로 거부한다.
// 새 초대는 받는 사람 이메일(recipientEmail)을 반드시 저장하고, 값이 있으면 정규화 이메일이 같아야 한다.
// 필수화 전에 저장된 초대(값이 null이거나 없음)는 만료나 취소 전까지 이메일 제한 없이 받는다(데이터는 옮기지 않는다).
// 문자열이 아닌 값은 제한 없음으로 보지 않고 recipient_mismatch로 거부한다.
function assertInviteRedeemable(
  invite: admin.firestore.DocumentData,
  normalizedEmail: string,
  nowMillis: number,
): void {
  if (invite['revokedAt'] != null) {
    throw inviteConflict('already_revoked', INVITE_REVOKED_MESSAGE);
  }
  if ((invite['expiresAt'] as admin.firestore.Timestamp).toMillis() < nowMillis) {
    throw new GoneException('만료된 초대 토큰입니다.');
  }
  if (invite['usedAt'] !== null) {
    throw new ConflictException('이미 사용된 초대 토큰입니다.');
  }
  const recipientEmail = invite['recipientEmail'];
  if (
    recipientEmail != null &&
    (typeof recipientEmail !== 'string' || normalizeEmail(recipientEmail) !== normalizedEmail)
  ) {
    throw inviteConflict('recipient_mismatch', INVITE_RECIPIENT_MISMATCH_MESSAGE);
  }
}

// 카카오 사용자 id(숫자)를 Firestore 문서 id로 쓸 수 있는지 확인한다.
const KAKAO_IDENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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

// 유예 안에 직전 토큰이 다시 오면 돌려줄 현재 refresh token. 유예 밖이거나 맞지 않으면 null.
function rotationGraceRefreshToken(
  stored: Record<string, unknown>,
  presented: string,
  nowMillis: number,
): string | null {
  const rotatedAt = stored['rotatedAt'];
  const currentToken = stored['token'];
  if (
    typeof currentToken !== 'string' ||
    typeof rotatedAt !== 'number' ||
    !matchesStoredRefreshToken(stored['previousToken'], presented)
  ) {
    return null;
  }
  const elapsed = nowMillis - rotatedAt;
  if (elapsed < 0 || elapsed > REFRESH_ROTATION_GRACE_MS) return null;
  // 배포 전 원문 기록은 현재 토큰 원문을 그대로 돌려준다.
  if (!isHashedRefreshTokenRecord(currentToken)) return currentToken;
  const opened = openRotatedRefreshToken(stored['sealedToken'], presented);
  if (opened === null || !matchesStoredRefreshToken(currentToken, opened)) return null;
  return opened;
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
    // 운영 화면은 카카오 로그인만 쓴다. 운영 런타임의 이메일 가입은 판매자 초대를 포함해 모두 막는다
    // (2026-10-18 결정, 판매자 초대만 받던 2026-10-10 결정을 대체). 초대 조회·소모 전에 막는다.
    // local·test·Preview·스테이징은 그대로 둔다(E2E와 로컬 시드가 쓴다).
    if (isProductionRuntime(getConfigValues(this.config))) {
      throw new ForbiddenException('이메일 회원가입은 지원하지 않습니다.');
    }

    // T2: seller는 inviteToken 필수 — 존재·취소·만료·재사용·받는 사람 검증
    if (dto.role === 'seller') {
      if (!dto.inviteToken) {
        throw new ForbiddenException('판매자 계정은 초대 토큰이 필요합니다.');
      }
      // 문서 경로에 쓰기 전에 관리자 취소 경로와 같은 형식 규칙으로 거른다(경로 구분자 등은 404).
      assertInviteTokenFormat(dto.inviteToken);

      const inviteSnap = await this.firestore.doc(`invites/${dto.inviteToken}`).get();

      if (!inviteSnap.exists) {
        throw new ForbiddenException('유효하지 않은 초대 토큰입니다.');
      }

      assertInviteRedeemable(inviteSnap.data()!, normalizeEmail(dto.email), Date.now());
    }

    // 연결 문서가 없는 기존 계정은 이메일 조회로 막는다.
    const existing = await this.firestore
      .collection('users')
      .where('email', '==', dto.email)
      .limit(1)
      .get();

    if (!existing.empty) {
      throw new ConflictException(EMAIL_IN_USE_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const userId = randomUUID();
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

    // 같은 이메일의 동시 가입이 사용자 문서를 둘 만들지 않도록 정규화 이메일의 연결 문서를
    // 사용자 문서와 한 트랜잭션에서 만든다(먼저 커밋한 요청만 성공).
    const normalizedEmail = normalizeEmail(dto.email);
    const emailIdentityRef = this.firestore.doc(
      `emailIdentities/${emailIdentityKey(normalizedEmail)}`,
    );
    const claimEmailIdentity = (
      tx: admin.firestore.Transaction,
      emailIdentitySnap: admin.firestore.DocumentSnapshot,
    ) => {
      if (emailIdentitySnap.exists) {
        throw new ConflictException(EMAIL_IN_USE_MESSAGE);
      }
      tx.create(emailIdentityRef, { userId, email: normalizedEmail, createdAt: now });
    };

    // T3: seller — 사용자 생성 + 토큰 소비를 단일 트랜잭션으로 묶어 정합성 보장
    let registration: Promise<void>;
    if (dto.role === 'seller' && dto.inviteToken) {
      registration = this.firestore.runTransaction(async (tx) => {
        const inviteRef = this.firestore.doc(`invites/${dto.inviteToken!}`);
        const inviteDoc = await tx.get(inviteRef);
        const emailIdentitySnap = await tx.get(emailIdentityRef);

        // 트랜잭션 내 재검증 — 동시 요청으로 인한 경쟁 조건 방지
        // (사전 검사 뒤 관리자 취소가 먼저 커밋됐거나 그사이 만료된 경우도 여기서 거부된다)
        if (!inviteDoc.exists) {
          throw new ConflictException('이미 사용된 초대 토큰입니다.');
        }
        assertInviteRedeemable(inviteDoc.data()!, normalizedEmail, Date.now());
        claimEmailIdentity(tx, emailIdentitySnap);

        tx.set(this.firestore.doc(`users/${userId}`), userDoc);
        tx.update(inviteRef, { usedAt: now, usedBy: userId });
      });
    } else {
      registration = this.firestore.runTransaction(async (tx) => {
        claimEmailIdentity(tx, await tx.get(emailIdentityRef));
        tx.set(this.firestore.doc(`users/${userId}`), userDoc);
      });
    }
    await registration.catch(rethrowEmailIdentityConflict);

    return { userId };
  }

  async login(dto: LoginDto) {
    // 운영 화면은 카카오 로그인만 쓴다. 운영 런타임의 이메일 로그인은 받지 않는다(2026-10-18 결정).
    // 계정 조회·비밀번호 비교 전에 막아 계정 상태와 무관하게 같은 응답을 준다. local·test·Preview·스테이징은 그대로 둔다.
    if (isProductionRuntime(getConfigValues(this.config))) {
      throw new ForbiddenException('이메일 로그인은 지원하지 않습니다.');
    }

    const snap = await this.firestore
      .collection('users')
      .where('email', '==', dto.email)
      .limit(1)
      .get();

    // 계정이 없거나 비밀번호가 없는(카카오 전용) 계정도 같은 비용의 bcrypt 비교를 거쳐
    // 같은 401로 끝낸다. 응답 내용과 시간으로 가입 여부·가입 방식이 드러나지 않게 한다.
    const userData = snap.empty ? undefined : snap.docs[0].data();
    const passwordHash = userData?.['passwordHash'];
    const hasPassword = typeof passwordHash === 'string';
    const matched = await bcrypt.compare(
      dto.password,
      hasPassword ? passwordHash : DUMMY_PASSWORD_HASH,
    );

    if (!userData) {
      await this.audit.log('auth.login.failed', {
        detail: { email: dto.email, reason: 'user_not_found' },
      });
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    if (!hasPassword || !matched) {
      await this.audit.log('auth.login.failed', {
        userId: userData['id'],
        detail: { email: dto.email, reason: hasPassword ? 'wrong_password' : 'password_not_set' },
      });
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
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
    const { passwordHash: _pw, [ACTIVE_SESSION_IDS_FIELD]: _sessions, ...user } = data;
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.firestore.doc(`users/${userId}`).update({
      ...dto,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return this.getMe(userId);
  }

  // 배송지 변경은 savedAddresses 배열 전체를 읽고 다시 쓰므로, 동시 요청이 서로의 변경을
  // 덮어쓰지 않도록 읽기와 쓰기를 한 트랜잭션에서 한다.
  async addAddress(userId: string, dto: AddressDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    return this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException();

      const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
      if (addresses.length >= SAVED_ADDRESS_MAX_COUNT) {
        throw new BadRequestException(
          `배송지는 최대 ${SAVED_ADDRESS_MAX_COUNT}개까지 저장할 수 있습니다.`,
        );
      }
      const newAddr = {
        id: randomUUID(),
        label: dto.label,
        address: dto.address,
        addressDetail: dto.addressDetail,
        zipCode: dto.zipCode,
        isDefault: dto.isDefault ?? addresses.length === 0,
      };

      if (newAddr.isDefault) {
        addresses.forEach((a) => {
          a.isDefault = false;
        });
      }
      addresses.push(newAddr);

      tx.update(ref, {
        savedAddresses: addresses,
        updatedAt: this.firestore.Timestamp.now(),
      });
      return newAddr;
    });
  }

  async updateAddress(userId: string, addressId: string, dto: AddressDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    return this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException();

      const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
      const idx = addresses.findIndex((a) => a.id === addressId);
      if (idx === -1) throw new NotFoundException('배송지를 찾을 수 없습니다.');

      if (dto.isDefault) {
        addresses.forEach((a) => {
          a.isDefault = false;
        });
      }
      addresses[idx] = { ...addresses[idx], ...dto, id: addressId };

      tx.update(ref, {
        savedAddresses: addresses,
        updatedAt: this.firestore.Timestamp.now(),
      });
      return addresses[idx];
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException();

      const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
      const filtered = addresses.filter((a) => a.id !== addressId);

      tx.update(ref, {
        savedAddresses: filtered,
        updatedAt: this.firestore.Timestamp.now(),
      });
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    return this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException();

      const addresses: any[] = snap.data()!['savedAddresses'] ?? [];
      const idx = addresses.findIndex((a) => a.id === addressId);
      if (idx === -1) throw new NotFoundException('배송지를 찾을 수 없습니다.');

      addresses.forEach((a) => {
        a.isDefault = false;
      });
      addresses[idx].isDefault = true;

      tx.update(ref, {
        savedAddresses: addresses,
        updatedAt: this.firestore.Timestamp.now(),
      });
      return addresses[idx];
    });
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
      userData = await this.createKakaoUser(kakaoProfile, dto.targetRole ?? 'consumer');
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

  // 카카오 첫 로그인의 사용자 생성. 같은 카카오 계정의 동시 요청(콜백 중복 등)이 사용자 문서를
  // 둘 만들지 않도록 `kakaoIdentities/{kakaoId}`를 트랜잭션 안에서 함께 써서 하나로 모은다.
  // 먼저 커밋한 요청이 만든 사용자를 나중 요청은 그대로 받는다.
  private async createKakaoUser(
    kakaoProfile: Awaited<ReturnType<KakaoClient['getUser']>>,
    newRole: NonNullable<KakaoLoginDto['targetRole']>,
  ): Promise<Record<string, unknown>> {
    if (!KAKAO_IDENTITY_ID_PATTERN.test(kakaoProfile.kakaoId)) {
      throw new UnauthorizedException('카카오 사용자 정보를 확인할 수 없습니다.');
    }
    const identityRef = this.firestore.doc(`kakaoIdentities/${kakaoProfile.kakaoId}`);

    return this.firestore.runTransaction(async (tx) => {
      const identitySnap = await tx.get(identityRef);
      const linkedUserId = identitySnap.exists ? identitySnap.data()?.['userId'] : undefined;
      if (typeof linkedUserId === 'string') {
        const linkedUserSnap = await tx.get(this.firestore.doc(`users/${linkedUserId}`));
        if (linkedUserSnap.exists) return linkedUserSnap.data() as Record<string, unknown>;
      }

      const userId = randomUUID();
      const now = this.firestore.Timestamp.now();
      const userData: Record<string, unknown> = {
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
      tx.set(identityRef, { userId, createdAt: now });
      tx.set(this.firestore.doc(`users/${userId}`), userData);
      return userData;
    });
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }
    if (!hasExpectedTokenClaims(payload, 'refresh')) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    // 기기별 세션 도입 전에 발급된 refresh token(`sid` 없음)은 이어 쓸 세션이 없으므로 다시 로그인하게 한다.
    // 재사용 신호가 아니므로 기록 변경·감사 없이 401로 끝낸다.
    const sid = payload.sid;
    if (!isSessionId(sid)) {
      throw new UnauthorizedException('만료된 리프레시 토큰입니다.');
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
      sid,
    };

    // Rotation(세션별): 이 세션에 저장된 최신 토큰이면 회전한다. 같은 세션의 동시 요청이나 쿠키 반영 전
    // 재요청으로 직전 토큰이 짧은 유예 안에 다시 오면, 다시 회전하지 않고 현재 토큰을 돌려준다.
    // 같은 세션의 그 밖의 토큰(이미 회전된 이전 토큰)은 탈취 후 재사용으로 보고 이 사용자의 모든 세션을
    // 끊는다. 다른 기기의 로그인·회전은 이 세션의 기록을 바꾸지 않으므로 재사용으로 판정되지 않는다.
    // 세션이 없으면(로그아웃·상한 초과로 끊김·이미 폐기) 재사용 신호로 보지 않고 401만 준다.
    const tokenRef = this.firestore.doc(`refreshTokens/${payload.sub}`);
    const userRef = this.firestore.doc(`users/${payload.sub}`);
    const outcome = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(tokenRef);
      const sessions = readRefreshSessions(snap.exists ? snap.data() : undefined);
      const session = sessions[sid];
      if (session === undefined) return { kind: 'missing' as const };
      if (matchesStoredRefreshToken(session.token, refreshToken)) {
        const tokens = this.signTokens(nextPayload);
        tx.set(tokenRef, {
          sessions: {
            ...sessions,
            [sid]: {
              token: hashRefreshToken(tokens.refreshToken),
              previousToken: hashRefreshToken(refreshToken),
              sealedToken: sealRotatedRefreshToken(tokens.refreshToken, refreshToken),
              rotatedAt: Date.now(),
              createdAt: session.createdAt,
            },
          },
          updatedAt: this.firestore.Timestamp.now(),
        });
        return { kind: 'issued' as const, tokens };
      }
      const graceRefreshToken = rotationGraceRefreshToken(session, refreshToken, Date.now());
      if (graceRefreshToken !== null) {
        return {
          kind: 'issued' as const,
          tokens: {
            accessToken: this.signAccessToken(nextPayload),
            refreshToken: graceRefreshToken,
          },
        };
      }
      this.revokeAllSessionsInTransaction(tx, tokenRef, userRef);
      return { kind: 'reused' as const };
    });

    if (outcome.kind === 'reused') {
      await this.audit.log('auth.token.stolen', {
        userId: payload.sub,
        detail: { sessionId: sid },
      });
      await revokeFirebaseSessions(payload.sub, this.logger);
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
    // 기기별 세션: refresh 바인딩은 access token의 `sid` 세션이다. `sid` 없는 이전 발급 토큰은
    // 이어 쓸 세션이 없으므로 폐기된 세션으로 본다.
    const currentUser = await this.getAuthoritativeUser(user.sub);
    if (
      !isStoreIdValue(user.storeId) ||
      user.role !== currentUser.role ||
      normalizeStoreId(user.storeId) !== currentUser.storeId
    ) {
      throw new UnauthorizedException('현재 사용자 권한과 일치하지 않는 세션입니다.');
    }

    if (!isSessionId(user.sid)) {
      throw new UnauthorizedException('폐기된 세션입니다.');
    }
    const tokenSnap = await this.firestore.doc(`refreshTokens/${user.sub}`).get();
    const sessions = readRefreshSessions(tokenSnap.exists ? tokenSnap.data() : undefined);
    if (sessions[user.sid] === undefined) {
      throw new UnauthorizedException('폐기된 세션입니다.');
    }

    return {
      sub: user.sub,
      role: currentUser.role,
      ...(currentUser.storeId !== null ? { storeId: currentUser.storeId } : {}),
    };
  }

  // 로그아웃은 요청한 access token의 세션(기기)만 끝낸다. 다른 기기의 refresh 세션과 access token,
  // Firebase 세션은 그대로 둔다(Firebase refresh token 폐기는 사용자 단위라 기기별로 끊을 수 없다).
  // 끝난 세션의 access token은 사용자 문서의 세션 목록에서 빠지므로 다음 요청부터 거부된다.
  // `sid` 없는 이전 발급 access token의 로그아웃은 어느 세션인지 알 수 없으므로 이전처럼 모든 세션을 끊는다.
  async logout(userId: string, sessionId?: string) {
    const tokenRef = this.firestore.doc(`refreshTokens/${userId}`);
    const userRef = this.firestore.doc(`users/${userId}`);

    if (!isSessionId(sessionId)) {
      await this.firestore.runTransaction(async (tx) => {
        this.revokeAllSessionsInTransaction(tx, tokenRef, userRef);
      });
      await revokeFirebaseSessions(userId, this.logger);
      await this.audit.log('auth.logout', { userId, detail: { scope: 'all' } });
      return;
    }

    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(tokenRef);
      const { [sessionId]: _ended, ...remaining } = readRefreshSessions(
        snap.exists ? snap.data() : undefined,
      );
      this.writeSessionsInTransaction(tx, tokenRef, userRef, remaining);
    });
    await this.audit.log('auth.logout', { userId, detail: { sessionId } });
  }

  async updateFcmToken(userId: string, fcmToken: string | null) {
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

  private withTokenType(payload: JwtPayload, typ: TokenType): JwtPayload {
    return {
      sub: payload.sub,
      role: payload.role,
      storeId: payload.storeId,
      sid: payload.sid,
      typ,
    };
  }

  private signAccessToken(payload: JwtPayload) {
    return this.jwt.sign(this.withTokenType(payload, 'access'), {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '1h'),
      algorithm: JWT_ALGORITHM,
      audience: JWT_AUDIENCE,
    });
  }

  private signTokens(payload: JwtPayload) {
    const accessToken = this.signAccessToken(payload);
    const refreshToken = this.jwt.sign(this.withTokenType(payload, 'refresh'), {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      algorithm: JWT_ALGORITHM,
      audience: JWT_AUDIENCE,
    });
    return { accessToken, refreshToken };
  }

  // 로그인(기기)마다 새 세션을 만든다. 같은 사용자의 다른 세션은 그대로 두고, 세션 수가 상한을 넘으면
  // 가장 오래 쓰이지 않은 세션을 끊는다(그 세션의 access token도 목록에서 빠져 거부된다).
  private async issueTokens(payload: Omit<JwtPayload, 'sid'>) {
    const sid = randomUUID();
    const { accessToken, refreshToken } = this.signTokens({ ...payload, sid });
    const tokenRef = this.firestore.doc(`refreshTokens/${payload.sub}`);
    const userRef = this.firestore.doc(`users/${payload.sub}`);

    const evicted = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(tokenRef);
      const next = addRefreshSession(
        readRefreshSessions(snap.exists ? snap.data() : undefined),
        sid,
        {
          token: hashRefreshToken(refreshToken),
          createdAt: Date.now(),
        },
      );
      this.writeSessionsInTransaction(tx, tokenRef, userRef, next.sessions);
      return next.evicted;
    });
    if (evicted.length > 0) {
      this.logger.log(`auth.session.evicted userId=${payload.sub} count=${evicted.length}`);
    }

    return { accessToken, refreshToken };
  }

  // 세션 맵과 사용자 문서의 살아 있는 세션 목록을 함께 다시 쓴다. 이전 단일 기록 형식의 필드는 남기지 않는다.
  private writeSessionsInTransaction(
    tx: admin.firestore.Transaction,
    tokenRef: admin.firestore.DocumentReference,
    userRef: admin.firestore.DocumentReference,
    sessions: RefreshSessions,
  ) {
    const sessionIds = Object.keys(sessions);
    if (sessionIds.length === 0) {
      tx.delete(tokenRef);
    } else {
      tx.set(tokenRef, { sessions, updatedAt: this.firestore.Timestamp.now() });
    }
    tx.update(userRef, { [ACTIVE_SESSION_IDS_FIELD]: sessionIds });
  }

  // 모든 세션 폐기(재사용 감지·`sid` 없는 이전 토큰의 로그아웃). 사용자 단위 폐기 시각은 이 경로와
  // 관리자 정지에서만 기록해, `sid` 없는 이전 발급 access token까지 다음 요청부터 거부되게 한다.
  private revokeAllSessionsInTransaction(
    tx: admin.firestore.Transaction,
    tokenRef: admin.firestore.DocumentReference,
    userRef: admin.firestore.DocumentReference,
  ) {
    tx.delete(tokenRef);
    tx.update(userRef, {
      [ACTIVE_SESSION_IDS_FIELD]: [],
      [SESSIONS_REVOKED_AT_FIELD]: this.firestore.Timestamp.fromMillis(sessionsRevokedAtMillis()),
    });
  }
}
