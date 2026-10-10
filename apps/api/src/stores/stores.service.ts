import { normalizeSalesMode } from '@greenhub/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  getConfigValues,
  isLocalRuntime,
  resolveFirebaseAdminSettings,
} from '../config/runtime-config';
import { FirestoreService } from '../firestore/firestore.service';
import { UpdateStoreDto } from './dto/update-store.dto';
import { isAllowedStoreLogoUrl, type StoreLogoUrlPolicy } from './store-logo-url';

const STORE_LOGO_URL_MESSAGE = 'logoUrl은 판매자 앱에서 올린 로고 이미지 주소만 사용할 수 있습니다';

/** 매장을 새로 만들 수 있는 역할. 판매자 앱 온보딩(`POST /stores`)만 이 경로를 쓴다. */
export const STORE_CREATOR_ROLES = ['seller'] as const;

@Injectable()
export class StoresService {
  private readonly logoUrlPolicy: StoreLogoUrlPolicy;

  constructor(
    private readonly firestore: FirestoreService,
    config: ConfigService,
  ) {
    const values = getConfigValues(config);
    this.logoUrlPolicy = {
      bucket: resolveFirebaseAdminSettings(values).storageBucket ?? '',
      allowLocalEmulator: isLocalRuntime(values),
    };
  }

  private assertLogoUrl(logoUrl: string | undefined, ownerId: string): void {
    if (logoUrl === undefined) return;
    if (!isAllowedStoreLogoUrl(logoUrl, ownerId, this.logoUrlPolicy)) {
      throw new BadRequestException(STORE_LOGO_URL_MESSAGE);
    }
  }

  async getStore(storeId: string, requesterId: string) {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다');
    const data = snap.data()!;
    if (data.ownerId !== requesterId)
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    return {
      id: storeId,
      name: data.name ?? '',
      ceoName: data.ceoName ?? '',
      phone: data.phone ?? '',
      address: data.address ?? '',
      businessNumber: data.businessNumber ?? null,
      logoUrl: data.logoUrl ?? null,
    };
  }

  /**
   * Public store profile — unauthenticated allowlist.
   * Returns exactly { id, name, logoUrl, salesMode }. Never PII/owner/
   * status/timestamps. Missing store → 404 (not empty profile).
   */
  async getPublicProfile(storeId: string) {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다');
    const data = snap.data()!;
    const salesMode = normalizeSalesMode(
      data.salesMode === 'round_direct' ? 'round_direct' : undefined,
    );
    return {
      id: storeId,
      name: data.name ?? '',
      logoUrl: data.logoUrl ?? null,
      salesMode,
    };
  }

  async createStore(requesterId: string, dto: UpdateStoreDto): Promise<{ storeId: string }> {
    this.assertLogoUrl(dto.logoUrl, requesterId);

    const storeId = randomUUID();
    const userRef = this.firestore.doc(`users/${requesterId}`);
    const storeRef = this.firestore.doc(`stores/${storeId}`);
    const deliveryFeeConfigRef = this.firestore.doc(`deliveryFeeConfig/${storeId}`);
    const existingStoreQuery = this.firestore
      .collection('stores')
      .where('ownerId', '==', requesterId)
      .limit(1);

    // 사용자 문서를 같은 트랜잭션에서 읽고 쓰므로, 동시에 들어온 생성 요청은 하나만 커밋되고
    // 나머지는 재시도에서 storeId를 보고 409로 끝난다. 매장·users.storeId·배송비 설정은 함께 커밋된다.
    await this.firestore.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new ForbiddenException('스토어를 만들 수 없는 계정입니다');
      }
      const user = userSnap.data() ?? {};
      if (!(STORE_CREATOR_ROLES as readonly unknown[]).includes(user['role'])) {
        throw new ForbiddenException('스토어를 만들 수 없는 계정입니다');
      }
      if (user['storeId']) {
        throw new ConflictException('이미 스토어가 존재합니다');
      }
      const existing = await tx.get(existingStoreQuery);
      if (!existing.empty) {
        throw new ConflictException('이미 스토어가 존재합니다');
      }

      const now = this.firestore.Timestamp.now();
      tx.create(storeRef, {
        id: storeId,
        ownerId: requesterId,
        name: dto.name ?? '',
        ceoName: dto.ceoName ?? '',
        phone: dto.phone ?? '',
        address: dto.address ?? '',
        businessNumber: dto.businessNumber ?? null,
        logoUrl: dto.logoUrl ?? null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      tx.update(userRef, {
        storeId,
        updatedAt: now,
      });

      // 배송비 기본 설정 자동 초기화
      tx.set(deliveryFeeConfigRef, {
        storeId,
        directFee: 3000,
        hubFee: 1000,
        parcelFee: 4000,
        freeThresholdDirect: 50000,
        freeThresholdHub: 30000,
        freeThresholdParcel: 50000,
        weatherRestrictionActive: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    return { storeId };
  }

  async updateStore(
    storeId: string,
    requesterId: string,
    dto: UpdateStoreDto,
  ): Promise<{ id: string }> {
    const storeRef = this.firestore.doc(`stores/${storeId}`);
    const storeSnap = await storeRef.get();

    if (!storeSnap.exists) {
      throw new NotFoundException('스토어를 찾을 수 없습니다');
    }

    const storeData = storeSnap.data();

    // **소유권 검증**: JWT의 storeId와 URL의 storeId가 일치해야 함
    if (storeData?.ownerId !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }

    // 이미 저장된 값을 그대로 다시 보내는 프로필 수정은 기존 값을 유지하므로 다시 검사하지 않는다.
    if (dto.logoUrl !== storeData?.logoUrl) {
      this.assertLogoUrl(dto.logoUrl, requesterId);
    }

    const updatePayload: Record<string, unknown> = {
      updatedAt: this.firestore.FieldValue.serverTimestamp(),
    };

    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.ceoName !== undefined) updatePayload.ceoName = dto.ceoName;
    if (dto.phone !== undefined) updatePayload.phone = dto.phone;
    if (dto.address !== undefined) updatePayload.address = dto.address;
    if (dto.businessNumber !== undefined) updatePayload.businessNumber = dto.businessNumber;
    if (dto.logoUrl !== undefined) updatePayload.logoUrl = dto.logoUrl;

    // **온보딩 완료 판별**: 필수 4개 필드 모두 채워지면 status를 active로 전환
    const merged = { ...storeData, ...updatePayload };
    const isOnboardingComplete = merged.name && merged.ceoName && merged.phone && merged.address;

    if (isOnboardingComplete && storeData?.status === 'invited') {
      updatePayload.status = 'active';
    }

    await storeRef.update(updatePayload);

    return { id: storeId };
  }
}
