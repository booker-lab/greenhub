import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly firestore: FirestoreService) {}

  async getProducts(storeId: string, query: ProductQueryDto) {
    let ref = this.firestore
      .collection('products')
      .where('storeId', '==', storeId);

    const isActive = query.isActive !== false;
    ref = ref.where('isActive', '==', isActive) as any;

    if (query.category) {
      ref = ref.where('category', '==', query.category) as any;
    }
    if (query.saleType) {
      ref = ref.where('saleType', '==', query.saleType) as any;
    }

    const snap = await ref.get();
    let products = snap.docs.map((d) => d.data());

    // 색상 필터 (Firestore array-contains-any는 10개 제한 — 앱 레이어에서 처리)
    if (query.colors) {
      const colorFilter = Array.isArray(query.colors)
        ? query.colors
        : query.colors.split(',');
      products = products.filter((p) =>
        colorFilter.some((c) => p['colors']?.includes(c)),
      );
    }

    // 정렬
    const sort = query.sort ?? 'latest';
    if (sort === 'price_asc') products.sort((a, b) => a['price'] - b['price']);
    else if (sort === 'price_desc')
      products.sort((a, b) => b['price'] - a['price']);
    else products.sort((a, b) => b['createdAt']?.seconds - a['createdAt']?.seconds);

    return { products };
  }

  async getProduct(storeId: string, productId: string) {
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    const product = snap.data()!;

    let groupConfig: Record<string, unknown> | null = null;
    if (product['saleType'] === 'group') {
      const gc = await this.firestore
        .doc(`groupProductConfig/${productId}`)
        .get();
      groupConfig = gc.exists ? (gc.data() as Record<string, unknown>) : null;
    }

    return { ...product, groupConfig };
  }

  async createProduct(
    storeId: string,
    sellerId: string,
    dto: CreateProductDto,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId);

    const productId = uuidv4();
    const now = this.firestore.Timestamp.now();
    const { groupConfig, ...productFields } = dto;

    await this.firestore.doc(`products/${productId}`).set({
      ...productFields,
      id: productId,
      storeId,
      isActive: dto.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });

    if (dto.saleType === 'group' && groupConfig) {
      await this.firestore.doc(`groupProductConfig/${productId}`).set({
        productId,
        ...groupConfig,
        currentParticipants: 0,
        recruitDeadline: new Date(groupConfig.recruitDeadline),
        groupDeliveryDate: new Date(groupConfig.groupDeliveryDate),
      });
    }

    return this.getProduct(storeId, productId);
  }

  async updateProduct(
    storeId: string,
    productId: string,
    sellerId: string,
    dto: Partial<CreateProductDto>,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId);
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }

    const { groupConfig, ...fields } = dto;
    await this.firestore.doc(`products/${productId}`).update({
      ...fields,
      updatedAt: this.firestore.Timestamp.now(),
    });

    if (groupConfig) {
      await this.firestore
        .doc(`groupProductConfig/${productId}`)
        .set({ productId, ...groupConfig }, { merge: true });
    }

    return this.getProduct(storeId, productId);
  }

  async deleteProduct(storeId: string, productId: string, sellerId: string) {
    await this.assertSellerOwnsStore(storeId, sellerId);
    await this.firestore
      .doc(`products/${productId}`)
      .update({ isActive: false, updatedAt: this.firestore.Timestamp.now() });
  }

  async getDeliveryConfig(storeId: string) {
    const snap = await this.firestore
      .doc(`deliveryFeeConfig/${storeId}`)
      .get();
    if (!snap.exists) {
      return {
        storeId,
        directFee: 3000,
        hubFee: 1000,
        parcelFee: 4000,
        freeThresholdDirect: 50000,
        freeThresholdHub: 30000,
        freeThresholdParcel: 50000,
        weatherRestrictionActive: false,
      };
    }
    return snap.data();
  }

  async updateDeliveryConfig(
    storeId: string,
    sellerId: string,
    dto: UpdateDeliveryConfigDto,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId);
    await this.firestore.doc(`deliveryFeeConfig/${storeId}`).set(
      { storeId, ...dto, updatedAt: this.firestore.Timestamp.now() },
      { merge: true },
    );
    return this.getDeliveryConfig(storeId);
  }

  private async assertSellerOwnsStore(storeId: string, sellerId: string) {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()!['ownerId'] !== sellerId) {
      throw new ForbiddenException('권한이 없습니다.');
    }
  }
}
