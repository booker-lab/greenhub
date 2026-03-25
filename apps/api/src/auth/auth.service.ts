import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
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

    return this.issueTokens({ sub: userId, role: dto.role as JwtPayload['role'] });
  }

  async login(dto: LoginDto) {
    const snap = await this.firestore
      .collection('users')
      .where('email', '==', dto.email)
      .limit(1)
      .get();

    if (snap.empty) throw new UnauthorizedException('인증 실패');

    const user = snap.docs[0].data();
    const valid = await bcrypt.compare(dto.password, user['passwordHash']);
    if (!valid) throw new UnauthorizedException('인증 실패');

    return this.issueTokens({
      sub: user['id'],
      role: user['role'],
      storeId: user['storeId'] ?? undefined,
    });
  }

  async getMe(userId: string) {
    const snap = await this.firestore.doc(`users/${userId}`).get();
    if (!snap.exists) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    const data = snap.data()!;
    const { passwordHash: _, ...user } = data;
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    await ref.update({
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
      address: dto.roadAddress,
      addressDetail: dto.detailAddress,
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
