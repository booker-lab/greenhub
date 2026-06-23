import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ProductQueryDto } from './dto/product-query.dto';
import type { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';

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

    const groupProductIds = products
      .filter((p) => p['saleType'] === 'group')
      .map((p) => p['id'] as string);

    const groupConfigMap = await this.getGroupConfigMap(groupProductIds);

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
          summary['groupSummary'] = this.toGroupSummary(gc);
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

    const today = new Date().toISOString().split('T')[0];
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
    const isActive = query.isActive !== false;
    let ref = this.firestore.collection('products').where('isActive', '==', isActive) as any;
    if (query.category) ref = ref.where('category', '==', query.category);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);

    const snap = await ref.get();
    let products = snap.docs.map((d: any) => d.data());

    if (query.colors) {
      const colorFilter = Array.isArray(query.colors)
        ? query.colors
        : String(query.colors).split(',');
      products = products.filter((p: any) => {
        const colors = p['selection']?.['colors'] ?? p['colors'] ?? [];
        return colorFilter.some((c: string) => colors.includes(c));
      });
    }

    products = this.filterByPrice(products, query);

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
    const groupConfigMap = await this.getGroupConfigMap(groupProductIds);
    const storeSummaryMap = await this.getStoreSummaryMap(products);
    const deliveryConfigMap = await this.getDeliveryConfigMapForProducts(products);

    if (query.deliveryMethod) {
      products = products.filter((p: any) =>
        this.productMatchesDeliveryMethod(
          p,
          query.deliveryMethod as string,
          groupConfigMap,
          deliveryConfigMap,
        ),
      );
    }

    const items = products.map((p: any) => {
      const gc = groupConfigMap.get(p['id'] as string);
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
        sellerSummary: this.toSellerSummary(p, storeSummaryMap),
        deliverySummary: this.toDeliverySummary(p, gc, deliveryConfigMap),
      };
      if (p['saleType'] === 'group') {
        if (gc) summary['groupSummary'] = this.toGroupSummary(gc);
      }
      return summary;
    });

    return { items, total: items.length };
  }

  async getPublicProduct(productId: string) {
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists) throw new NotFoundException('상품을 찾을 수 없습니다.');
    const product = snap.data()!;
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

  private async getGroupConfigMap(productIds: string[]) {
    const groupConfigMap = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < productIds.length; i += 30) {
      const batch = productIds.slice(i, i + 30);
      if (batch.length === 0) continue;
      const gcSnap = await this.firestore
        .collection('groupProductConfig')
        .where('productId', 'in', batch)
        .get();
      gcSnap.docs.forEach((d: any) => {
        const data = d.data();
        groupConfigMap.set(data['productId'], data);
      });
    }
    return groupConfigMap;
  }

  private filterByPrice(products: Record<string, unknown>[], query: ProductQueryDto) {
    return products.filter((product) => {
      const price = Number(product['price']);
      if (Number.isNaN(price)) return false;
      if (query.priceMin !== undefined && price < query.priceMin) return false;
      if (query.priceMax !== undefined && price > query.priceMax) return false;
      return true;
    });
  }

  private async getStoreSummaryMap(products: Record<string, unknown>[]) {
    const storeIds = this.getUniqueStoreIds(products);
    const storeMap = new Map<string, Record<string, unknown>>();
    await Promise.all(
      storeIds.map(async (storeId) => {
        const snap = await this.firestore.doc(`stores/${storeId}`).get();
        if (snap.exists) storeMap.set(storeId, snap.data() as Record<string, unknown>);
      }),
    );
    return storeMap;
  }

  private async getDeliveryConfigMapForProducts(products: Record<string, unknown>[]) {
    const storeIds = this.getUniqueStoreIds(products);
    const deliveryConfigMap = new Map<string, Record<string, unknown>>();
    await Promise.all(
      storeIds.map(async (storeId) => {
        const snap = await this.firestore.doc(`deliveryFeeConfig/${storeId}`).get();
        deliveryConfigMap.set(storeId, snap.exists ? (snap.data() as Record<string, unknown>) : {});
      }),
    );
    return deliveryConfigMap;
  }

  private getUniqueStoreIds(products: Record<string, unknown>[]) {
    return Array.from(
      new Set(products.map((product) => product['storeId']).filter(Boolean) as string[]),
    );
  }

  private productMatchesDeliveryMethod(
    product: Record<string, unknown>,
    deliveryMethod: string,
    groupConfigMap: Map<string, Record<string, unknown>>,
    deliveryConfigMap: Map<string, Record<string, unknown>>,
  ) {
    const methods =
      product['saleType'] === 'group'
        ? this.getGroupDeliveryMethods(product, groupConfigMap)
        : this.getNormalDeliveryMethods(deliveryConfigMap.get(product['storeId'] as string));
    return methods.includes(deliveryMethod);
  }

  private getGroupDeliveryMethods(
    product: Record<string, unknown>,
    groupConfigMap: Map<string, Record<string, unknown>>,
  ) {
    const config = groupConfigMap.get(product['id'] as string);
    const method = config?.['groupDeliveryMethod'];
    return typeof method === 'string' ? [method] : [];
  }

  private getNormalDeliveryMethods(deliveryConfig: Record<string, unknown> | undefined) {
    const methods = ['direct', 'hub'];
    if (deliveryConfig?.['weatherRestrictionActive'] !== true) methods.push('parcel');
    return methods;
  }

  private toSellerSummary(
    product: Record<string, unknown>,
    storeSummaryMap: Map<string, Record<string, unknown>>,
  ) {
    const storeId = product['storeId'] as string;
    const store = storeSummaryMap.get(storeId);
    const name = typeof store?.['name'] === 'string' ? store['name'] : storeId;
    return { storeId, name };
  }

  private toDeliverySummary(
    product: Record<string, unknown>,
    groupConfig: Record<string, unknown> | undefined,
    deliveryConfigMap: Map<string, Record<string, unknown>>,
  ) {
    const isGroup = product['saleType'] === 'group';
    const config = deliveryConfigMap.get(product['storeId'] as string);
    const methods = isGroup
      ? this.getGroupDeliveryMethods(
          product,
          new Map([[product['id'] as string, groupConfig ?? {}]]),
        )
      : this.getNormalDeliveryMethods(config);
    const summary: Record<string, unknown> = {
      methods,
      deliverySize: product['deliverySize'],
      weatherRestricted: config?.['weatherRestrictionActive'] === true,
    };
    if (isGroup && groupConfig) {
      summary['groupDeliveryDate'] = this.toIsoDateValue(groupConfig['groupDeliveryDate']);
      summary['deliveryFeeDiscount'] = groupConfig['deliveryFeeDiscount'];
    }
    return summary;
  }

  private toIsoDateValue(value: unknown) {
    if (typeof (value as { toDate?: () => Date })?.toDate === 'function') {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    return value;
  }

  private toGroupSummary(gc: Record<string, unknown>) {
    return {
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
