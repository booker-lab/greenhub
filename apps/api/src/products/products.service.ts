import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { todayKST } from '@greenhub/shared';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly firestore: FirestoreService) {}

  async getProducts(storeId: string, query: ProductQueryDto) {
    let ref = this.firestore.collection('products').where('storeId', '==', storeId);

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

    // 색상 필터 — 신규(selection.colors) / 구버전(colors) 모두 지원
    if (query.colors) {
      const colorFilter = Array.isArray(query.colors)
        ? query.colors
        : String(query.colors).split(',');
      products = products.filter((p) => {
        const colors = p['selection']?.['colors'] ?? p['colors'] ?? [];
        return colorFilter.some((c) => colors.includes(c));
      });
    }

    // 정렬
    const sort = query.sort ?? 'latest';
    if (sort === 'price_asc') products.sort((a, b) => a['price'] - b['price']);
    else if (sort === 'price_desc') products.sort((a, b) => b['price'] - a['price']);
    else products.sort((a, b) => (b['createdAt']?.seconds ?? 0) - (a['createdAt']?.seconds ?? 0));

    // groupSummary 병합 (공동구매 상품만)
    const groupProductIds = products
      .filter((p) => p['saleType'] === 'group')
      .map((p) => p['id'] as string);

    const groupConfigMap = new Map<string, Record<string, unknown>>();
    if (groupProductIds.length > 0) {
      // Firestore 'in' 쿼리는 30개 제한이지만 MVP는 충분
      const gcSnap = await this.firestore
        .collection('groupProductConfig')
        .where('productId', 'in', groupProductIds.slice(0, 30))
        .get();
      gcSnap.docs.forEach((d) => groupConfigMap.set(d.data()['productId'], d.data()));
    }

    // 스펙 응답: { items: ProductSummary[], total: number }
    const items = products.map((p) => {
      const summary: Record<string, unknown> = {
        id: p['id'],
        name: p['name'],
        price: p['price'],
        images: Array.isArray(p['images']) ? [p['images'][0]] : [],
        category: p['category'],
        colors: p['selection']?.['colors'] ?? p['colors'] ?? [],
        saleType: p['saleType'],
        isActive: p['isActive'],
      };
      if (p['saleType'] === 'group') {
        const gc = groupConfigMap.get(p['id'] as string);
        if (gc) {
          summary['groupSummary'] = {
            currentQuantity: gc['currentQuantity'],
            minQuantity: gc['minQuantity'],
            targetQuantity: gc['targetQuantity'],
            recruitDeadline:
              typeof (gc['recruitDeadline'] as { toDate?: () => Date })?.toDate === 'function'
                ? (gc['recruitDeadline'] as { toDate: () => Date }).toDate().toISOString()
                : gc['recruitDeadline'],
          };
        }
      }
      return summary;
    });

    return { items, total: items.length };
  }

  async getProduct(storeId: string, productId: string) {
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    const product = snap.data()!;

    let groupConfig: Record<string, unknown> | null = null;
    if (product['saleType'] === 'group') {
      const gc = await this.firestore.doc(`groupProductConfig/${productId}`).get();
      groupConfig = gc.exists ? (gc.data() as Record<string, unknown>) : null;
    }

    // groupConfig가 있을 때만 포함 (스펙: optional 필드)
    if (groupConfig) {
      const gc: Record<string, unknown> = { ...groupConfig };
      const rd = gc['recruitDeadline'] as { toDate?: () => Date };
      const gd = gc['groupDeliveryDate'] as { toDate?: () => Date };
      if (typeof rd?.toDate === 'function') gc['recruitDeadline'] = rd.toDate().toISOString();
      if (typeof gd?.toDate === 'function') gc['groupDeliveryDate'] = gd.toDate().toISOString();
      return { ...product, groupConfig: gc };
    }
    return { ...product };
  }

  async createProduct(storeId: string, sellerId: string, dto: CreateProductDto, role?: string) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);

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
        currentQuantity: 0,
        recruitDeadline: new Date(groupConfig.recruitDeadline),
        groupDeliveryDate: new Date(groupConfig.groupDeliveryDate),
        isProcessed: false,
      });
    }

    return this.getProduct(storeId, productId);
  }

  async updateProduct(
    storeId: string,
    productId: string,
    sellerId: string,
    dto: Partial<CreateProductDto>,
    role?: string,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }

    const { groupConfig, content, ...fields } = dto;
    const contentUpdate = content ? { content } : {};
    await this.firestore.doc(`products/${productId}`).update({
      ...fields,
      ...contentUpdate,
      updatedAt: this.firestore.Timestamp.now(),
    });

    if (groupConfig) {
      await this.firestore
        .doc(`groupProductConfig/${productId}`)
        .set({ productId, ...groupConfig }, { merge: true });
    }

    return this.getProduct(storeId, productId);
  }

  async toggleProductActive(
    storeId: string,
    productId: string,
    sellerId: string,
    isActive: boolean,
    role?: string,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    await this.firestore.doc(`products/${productId}`).update({
      isActive,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return { productId, isActive };
  }

  async deleteProduct(storeId: string, productId: string, sellerId: string, role?: string) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    await this.firestore.doc(`products/${productId}`).delete();
  }

  async getDailyCaps(storeId: string, sellerId: string, from?: string, to?: string, role?: string) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);

    const today = todayKST();
    const fromDate = from ?? today;
    const toDate = to ?? today;

    const snap = await this.firestore
      .collection('dailyCaps')
      .where('storeId', '==', storeId)
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .get();

    return { caps: snap.docs.map((d) => d.data()) };
  }

  async updateDailyCap(
    storeId: string,
    date: string,
    sellerId: string,
    totalCap: number,
    role?: string,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    const docId = `${storeId}_${date}`;
    await this.firestore
      .doc(`dailyCaps/${docId}`)
      .set({ id: docId, storeId, date, totalCap }, { merge: true });
    const snap = await this.firestore.doc(`dailyCaps/${docId}`).get();
    return snap.data();
  }

  async getDeliveryConfig(storeId: string) {
    const snap = await this.firestore.doc(`deliveryFeeConfig/${storeId}`).get();
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
    role?: string,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    await this.firestore
      .doc(`deliveryFeeConfig/${storeId}`)
      .set({ storeId, ...dto, updatedAt: this.firestore.Timestamp.now() }, { merge: true });
    return this.getDeliveryConfig(storeId);
  }

  // ── Public (storeId-free) ─────────────────────────────────────────────────

  async getPublicProducts(query: ProductQueryDto) {
    let ref = this.firestore.collection('products').where('isActive', '==', true) as any;
    if (query.category) ref = ref.where('category', '==', query.category);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);

    const snap = await ref.get();
    let products = snap.docs
      .map((d: any) => d.data())
      .filter((product: Record<string, unknown>) => product['testOnly'] !== true);

    if (query.colors) {
      const colorFilter = Array.isArray(query.colors)
        ? query.colors
        : String(query.colors).split(',');
      products = products.filter((p: any) => {
        const colors = p['selection']?.['colors'] ?? p['colors'] ?? [];
        return colorFilter.some((c: string) => colors.includes(c));
      });
    }

    const sort = query.sort ?? 'latest';
    if (sort === 'price_asc') products.sort((a: any, b: any) => a['price'] - b['price']);
    else if (sort === 'price_desc') products.sort((a: any, b: any) => b['price'] - a['price']);
    else
      products.sort(
        (a: any, b: any) => (b['createdAt']?.seconds ?? 0) - (a['createdAt']?.seconds ?? 0),
      );

    const groupProductIds = products
      .filter((p: any) => p['saleType'] === 'group')
      .map((p: any) => p['id'] as string);
    const groupConfigMap = new Map<string, Record<string, unknown>>();
    if (groupProductIds.length > 0) {
      const gcSnap = await this.firestore
        .collection('groupProductConfig')
        .where('productId', 'in', groupProductIds.slice(0, 30))
        .get();
      gcSnap.docs.forEach((d: any) => groupConfigMap.set(d.data()['productId'], d.data()));
    }

    const items = products.map((p: any) => {
      const summary: Record<string, unknown> = {
        id: p['id'],
        storeId: p['storeId'],
        name: p['name'],
        price: p['price'],
        images: Array.isArray(p['images']) ? [p['images'][0]] : [],
        category: p['category'],
        colors: p['selection']?.['colors'] ?? p['colors'] ?? [],
        saleType: p['saleType'],
        isActive: p['isActive'],
      };
      if (p['saleType'] === 'group') {
        const gc = groupConfigMap.get(p['id'] as string);
        if (gc)
          summary['groupSummary'] = {
            currentQuantity: gc['currentQuantity'],
            minQuantity: gc['minQuantity'],
            targetQuantity: gc['targetQuantity'],
            recruitDeadline: gc['recruitDeadline'],
          };
      }
      return summary;
    });

    return { items, total: items.length };
  }

  async getPublicProduct(productId: string) {
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists) throw new NotFoundException('상품을 찾을 수 없습니다.');
    const product = snap.data()!;
    if (product['isActive'] !== true || product['testOnly'] === true) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    if (product['saleType'] === 'group') {
      const gc = await this.firestore.doc(`groupProductConfig/${productId}`).get();
      if (gc.exists) return { ...product, groupConfig: gc.data() };
    }
    return { ...product };
  }

  private async assertSellerOwnsStore(storeId: string, sellerId: string, role?: string) {
    if (role === 'admin') return;
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()!['ownerId'] !== sellerId) {
      throw new ForbiddenException('권한이 없습니다.');
    }
  }
}
