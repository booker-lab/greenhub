import type { ProductSummary, PublicStoreDetail, PublicStoreSummary } from '@greenhub/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { getDefaultCommissionRate } from '../admin/admin-platform-config.helpers';
// biome-ignore lint/style/useImportType: NestJS 생성자 주입 메타데이터에 런타임 값이 필요하다.
import { FirestoreService } from '../firestore/firestore.service';
import type { UpdateStoreDto } from './dto/update-store.dto';

@Injectable()
export class StoresService {
  constructor(private readonly firestore: FirestoreService) {}

  async getPublicStores(): Promise<{ items: PublicStoreSummary[]; total: number }> {
    const snap = await this.firestore.collection('stores').where('status', '==', 'active').get();
    const items = await Promise.all(
      snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) =>
        this.toPublicStoreSummary(doc.id, doc.data()),
      ),
    );

    items.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { items, total: items.length };
  }

  async getPublicStore(
    storeId: string,
  ): Promise<{ store: PublicStoreDetail; products: ProductSummary[] }> {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()?.status !== 'active') {
      throw new NotFoundException('스토어를 찾을 수 없습니다');
    }

    const store = await this.toPublicStoreDetail(storeId, snap.data() ?? {});
    const productSnap = await this.firestore
      .collection('products')
      .where('storeId', '==', storeId)
      .where('isActive', '==', true)
      .get();
    const products = productSnap.docs.map((doc: { data: () => Record<string, unknown> }) =>
      this.toProductSummary(doc.data()),
    );

    products.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    return { store, products };
  }

  async getStore(storeId: string, requesterId: string, requesterRole?: string) {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다');
    const data = snap.data() ?? {};
    if (requesterRole !== 'admin' && data.ownerId !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }
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

  async createStore(requesterId: string, dto: UpdateStoreDto): Promise<{ storeId: string }> {
    // 이미 스토어가 있는지 확인
    const existing = await (
      this.firestore.collection('stores').where('ownerId', '==', requesterId) as any
    ).get();
    if (!existing.empty) {
      throw new ConflictException('이미 스토어가 존재합니다');
    }

    const storeId = uuidv4();
    const now = this.firestore.Timestamp.now();
    const commissionRate = await getDefaultCommissionRate(this.firestore);

    await this.firestore.doc(`stores/${storeId}`).set({
      id: storeId,
      ownerId: requesterId,
      name: dto.name ?? '',
      ceoName: dto.ceoName ?? '',
      phone: dto.phone ?? '',
      address: dto.address ?? '',
      businessNumber: dto.businessNumber ?? null,
      logoUrl: dto.logoUrl ?? null,
      status: 'active',
      commissionRate,
      createdAt: now,
      updatedAt: now,
    });

    // user 문서에 storeId 업데이트
    await this.firestore.doc(`users/${requesterId}`).update({
      storeId,
      updatedAt: now,
    });

    // 배송비 기본 설정 자동 초기화
    await this.firestore.doc(`deliveryFeeConfig/${storeId}`).set({
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

    return { storeId };
  }

  async updateStore(
    storeId: string,
    requesterId: string,
    dto: UpdateStoreDto,
    requesterRole?: string,
  ): Promise<{ id: string }> {
    const storeRef = this.firestore.doc(`stores/${storeId}`);
    const storeSnap = await storeRef.get();

    if (!storeSnap.exists) {
      throw new NotFoundException('스토어를 찾을 수 없습니다');
    }

    const storeData = storeSnap.data();

    // **소유권 검증**: JWT의 storeId와 URL의 storeId가 일치해야 함
    if (requesterRole !== 'admin' && storeData?.ownerId !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
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

  private async toPublicStoreSummary(
    storeId: string,
    data: Record<string, unknown>,
  ): Promise<PublicStoreSummary> {
    const [products, hubs] = await Promise.all([
      this.firestore
        .collection('products')
        .where('storeId', '==', storeId)
        .where('isActive', '==', true)
        .get(),
      this.firestore
        .collection('hubs')
        .where('storeId', '==', storeId)
        .where('isActive', '==', true)
        .get(),
    ]);

    return {
      id: storeId,
      name: String(data.name ?? ''),
      address: String(data.address ?? ''),
      logoUrl: typeof data.logoUrl === 'string' ? data.logoUrl : null,
      productCount: products.docs.length,
      hubCount: hubs.docs.length,
    };
  }

  private async toPublicStoreDetail(
    storeId: string,
    data: Record<string, unknown>,
  ): Promise<PublicStoreDetail> {
    return {
      ...(await this.toPublicStoreSummary(storeId, data)),
      phone: String(data.phone ?? ''),
    };
  }

  private toProductSummary(data: Record<string, unknown>): ProductSummary {
    const images = Array.isArray(data.images) ? data.images.filter(Boolean).slice(0, 1) : [];
    const selection = data.selection as { colors?: unknown[] } | undefined;
    return {
      id: String(data.id ?? ''),
      storeId: String(data.storeId ?? ''),
      name: String(data.name ?? ''),
      price: Number(data.price ?? 0),
      images: images.map(String),
      category: data.category as ProductSummary['category'],
      colors: (selection?.colors ?? data.colors ?? []) as ProductSummary['colors'],
      saleType: data.saleType as ProductSummary['saleType'],
      isActive: data.isActive !== false,
    };
  }
}
