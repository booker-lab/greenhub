import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { AddressDto } from './dto/address.dto';
import { KakaoLoginDto } from './dto/kakao-login.dto';
import type { JwtPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
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

    await this.firestore.doc(`users/${userId}`).set({
      id: userId,
      email: dto.email,
      name: dto.name,
      phone: dto.phone ?? null,
      role: dto.role,
      storeId: null,
      providers: ['email'],
      passwordHash,
      savedAddresses: [],
      fcmToken: null,
      createdAt: now,
      updatedAt: now,
    });

    // 스펙: 201 { userId }
    return { userId };
  }

  async login(dto: LoginDto) {
    const snap = await this.firestore
      .collection('users')
      .where('email', '==', dto.email)
      .limit(1)
      .get();

    if (snap.empty) throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');

    const userData = snap.docs[0].data();
    const valid = await bcrypt.compare(dto.password, userData['passwordHash']);
    if (!valid) throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');

    const { accessToken, refreshToken } = this.issueTokens({
      sub: userData['id'],
      role: userData['role'],
      storeId: userData['storeId'] ?? undefined,
    });

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
    const snap = await this.firestore
      .collection('users')
      .where('kakaoId', '==', dto.kakaoId)
      .limit(1)
      .get();

    let userData: Record<string, unknown>;

    if (!snap.empty) {
      userData = snap.docs[0].data();
      // 기존 드라이버 계정에 driverApproved 필드가 없으면 false로 초기화
      if (userData['role'] === 'driver' && userData['driverApproved'] === undefined) {
        await this.firestore.doc(`users/${userData['id']}`).update({
          driverApproved: false,
          updatedAt: this.firestore.Timestamp.now(),
        });
        userData = { ...userData, driverApproved: false };
      }
    } else {
      // seller는 admin 초대로만 가입 가능 — 카카오 신규 생성 불가
      if (dto.targetRole === 'seller') {
        throw new ForbiddenException('판매자 계정은 관리자 초대로만 가입할 수 있습니다.');
      }
      const userId = uuidv4();
      const now = this.firestore.Timestamp.now();
      const newRole = dto.targetRole ?? 'driver';
      userData = {
        id: userId,
        kakaoId: dto.kakaoId,
        email: dto.email ?? null,
        name: dto.name,
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
    const allowedRoles = dto.targetRole === 'consumer'
      ? ['consumer', 'seller', 'admin']
      : dto.targetRole === 'seller'
        ? ['seller', 'admin']
        : ['driver'];
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }

    const { accessToken, refreshToken } = this.issueTokens({
      sub: userData['id'] as string,
      role: role as JwtPayload['role'],
      storeId: (userData['storeId'] as string) ?? undefined,
    });

    return { accessToken, refreshToken, user: this.sanitizeUser(userData) };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      }) as JwtPayload;
      return this.issueTokens({
        sub: payload.sub,
        role: payload.role,
        storeId: payload.storeId,
      });
    } catch {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }
  }

  async updateFcmToken(userId: string, fcmToken: string) {
    await this.firestore.doc(`users/${userId}`).update({
      fcmToken,
      updatedAt: this.firestore.Timestamp.now(),
    });
  }

  private issueTokens(payload: JwtPayload) {
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '1h'),
    });
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
    });
    return { accessToken, refreshToken };
  }
}
