import { optionStockRemaining, type ProductOptionAvailability, todayKST } from '@greenhub/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateProductDto } from './dto/create-product.dto';
import { findProductOptionIdConflict } from './dto/product-extras.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  isPubliclyVisibleProduct,
  toOwnerProductDetail,
  toPublicGroupSummary,
  toPublicProductDetail,
  toPublicProductSummary,
} from './product-visibility';
import { isArchivedStore } from '../stores/store-availability';
import { assertOptionStocksBelongToStore } from '../option-stocks/option-stocks.service';
import { optionStockPath } from '../option-stocks/option-stock.fields';

function assertProductOptionIds(options: CreateProductDto['options']): void {
  const conflict = findProductOptionIdConflict(options);
  if (conflict) throw new BadRequestException(conflict);
}

/** 공개 옵션 남은 수량의 상한(손님 옵션 시트가 한 번에 담을 수 있는 최대 수량). */
const PUBLIC_OPTION_REMAINING_CAP = 99;

@Injectable()
export class ProductsService {
  constructor(private readonly firestore: FirestoreService) {}

  async getProducts(storeId: string, query: ProductQueryDto) {
    // Anonymous store-scoped list is PUBLIC: always enforce the canonical
    // visibility predicate (isActive === true AND testOnly !== true).
    // query.isActive is intentionally ignored here — inactive/testOnly must
    // never leak through the store-scoped bypass.
    await this.assertPublicStore(storeId);
    let ref = this.firestore.collection('products').where('storeId', '==', storeId);

    ref = ref.where('isActive', '==', true);

    if (query.category) {
      ref = ref.where('category', '==', query.category);
    }
    if (query.saleType) {
      ref = ref.where('saleType', '==', query.saleType);
    }

    const snap = await ref.get();
    let products = snap.docs
      .map((d) => d.data())
      .filter((p) => isPubliclyVisibleProduct(p as Record<string, unknown>));

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
    for (let offset = 0; offset < groupProductIds.length; offset += 30) {
      // Firestore 'in' 조회 제한 내에서 모든 반환 대상의 설정을 읽는다.
      const gcSnap = await this.firestore
        .collection('groupProductConfig')
        .where('productId', 'in', groupProductIds.slice(offset, offset + 30))
        .get();
      gcSnap.docs.forEach((d) => {
        groupConfigMap.set(d.data()['productId'], d.data());
      });
    }

    // 스펙 응답: { items: ProductSummary[], total: number }
    // Public summary is an explicit allowlist — never spread the stored doc.
    const items = products.map((p) => {
      const gc = groupConfigMap.get(p['id'] as string);
      const summary = toPublicProductSummary(
        p,
        gc ?? null,
      );
      // Backfill groupSummary for group products when the helper omitted it
      // (kept for contract compat with the previous manual shape).
      if (p['saleType'] === 'group' && gc && !summary['groupSummary']) {
        summary['groupSummary'] = toPublicGroupSummary(gc);
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
    const product = snap.data()! as Record<string, unknown>;
    // Anonymous store-scoped detail is PUBLIC: same canonical predicate.
    if (!isPubliclyVisibleProduct(product) || (await this.isArchivedStoreId(storeId))) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }

    let groupConfig: Record<string, unknown> | null = null;
    if (product['saleType'] === 'group') {
      const gc = await this.firestore.doc(`groupProductConfig/${productId}`).get();
      groupConfig = gc.exists ? (gc.data() as Record<string, unknown>) : null;
    }

    return toPublicProductDetail(product, groupConfig);
  }

  /**
   * Owner/internal detail — seller mutation/read path.
   * No visibility filtering, full fidelity (sellerNote/content.isEditedByUser/
   * sellerOverride/testOnly preserved). Ownership is enforced.
   */
  async getOwnerProduct(storeId: string, productId: string, sellerId: string, role?: string) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    return this.getOwnerProductInternal(storeId, productId);
  }

  private async getOwnerProductInternal(storeId: string, productId: string) {
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    const product = snap.data()! as Record<string, unknown>;

    let groupConfig: Record<string, unknown> | null = null;
    if (product['saleType'] === 'group') {
      const gc = await this.firestore.doc(`groupProductConfig/${productId}`).get();
      groupConfig = gc.exists ? (gc.data() as Record<string, unknown>) : null;
    }
    return toOwnerProductDetail(product, groupConfig);
  }

  async createProduct(storeId: string, sellerId: string, dto: CreateProductDto, role?: string) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    assertProductOptionIds(dto.options);
    await assertOptionStocksBelongToStore(this.firestore, storeId, dto.options);

    const productId = randomUUID();
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

    return this.getOwnerProductInternal(storeId, productId);
  }

  async updateProduct(
    storeId: string,
    productId: string,
    sellerId: string,
    dto: UpdateProductDto,
    role?: string,
  ) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    assertProductOptionIds(dto.options);
    await assertOptionStocksBelongToStore(this.firestore, storeId, dto.options);
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

    return this.getOwnerProductInternal(storeId, productId);
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

    // 주문·회차 상품이 이 상품을 가리키면 지우지 않고 판매 중지로 안내한다(판매자 치우기와 같은 방식).
    // 여러 상품 회차 주문도 상품마다 saleRoundItems 문서를 거치므로 두 컬렉션으로 참조를 모두 덮는다.
    // 존재 여부만 확인하면 되므로 limit(1) — 단일 필드 자동 인덱스로 충분하다.
    const ref = this.firestore.doc(`products/${productId}`);
    await this.firestore.runTransaction(async (tx) => {
      const [orderSnap, roundItemSnap] = await Promise.all([
        tx.get(this.firestore.collection('orders').where('productId', '==', productId).limit(1)),
        tx.get(
          this.firestore.collection('saleRoundItems').where('productId', '==', productId).limit(1),
        ),
      ]);
      if (!orderSnap.empty || !roundItemSnap.empty) {
        throw new ConflictException(
          '주문·회차에 쓰인 상품은 지울 수 없어요. 판매 중지를 눌러 주세요.',
        );
      }
      tx.delete(ref);
    });
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
    const capRef = this.firestore.doc(`dailyCaps/${docId}`);
    await this.firestore.runTransaction(async (tx) => {
      const capSnap = await tx.get(capRef);
      tx.set(
        capRef,
        {
          id: docId,
          storeId,
          date,
          totalCap,
          ...(capSnap.exists ? {} : { usedSlots: 0 }),
        },
        { merge: true },
      );
    });
    const snap = await capRef.get();
    return snap.data();
  }

  // 손님 쪽 공개 조회. 치운(archived) 가게는 없는 가게처럼 404로 숨긴다.
  async getDeliveryConfig(storeId: string) {
    await this.assertPublicStore(storeId);
    return this.readDeliveryConfig(storeId);
  }

  // 판매자 본인·관리자용 조회. 치운 가게의 판매자도 자기 설정은 볼 수 있다.
  async getOwnerDeliveryConfig(storeId: string, sellerId: string, role?: string) {
    await this.assertSellerOwnsStore(storeId, sellerId, role);
    return this.readDeliveryConfig(storeId);
  }

  private async readDeliveryConfig(storeId: string) {
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
    return this.readDeliveryConfig(storeId);
  }

  // ── Public (storeId-free) ─────────────────────────────────────────────────

  async getPublicProducts(query: ProductQueryDto) {
    let ref = this.firestore.collection('products').where('isActive', '==', true) as any;
    if (query.category) ref = ref.where('category', '==', query.category);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);

    const snap = await ref.get();
    const visible = snap.docs
      .map((d: any) => d.data())
      .filter((product: Record<string, unknown>) => isPubliclyVisibleProduct(product));
    // 치운(archived) 가게의 상품은 전체 목록에서도 뺀다.
    const archivedStoreIds = await this.readArchivedStoreIds(
      visible.map((product: Record<string, unknown>) => product['storeId']),
    );
    let products = visible.filter(
      (product: Record<string, unknown>) => !archivedStoreIds.has(product['storeId'] as string),
    );

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
    for (let offset = 0; offset < groupProductIds.length; offset += 30) {
      const gcSnap = await this.firestore
        .collection('groupProductConfig')
        .where('productId', 'in', groupProductIds.slice(offset, offset + 30))
        .get();
      gcSnap.docs.forEach((d: any) => {
        groupConfigMap.set(d.data()['productId'], d.data());
      });
    }

    const items = products.map((p: any) =>
      toPublicProductSummary(p as Record<string, unknown>, groupConfigMap.get(p['id'] as string) ?? null, {
        includeStoreId: true,
      }),
    );

    return { items, total: items.length };
  }

  async getPublicProduct(productId: string) {
    const product = await this.loadPublicProduct(productId);
    if (product['saleType'] === 'group') {
      const gc = await this.firestore.doc(`groupProductConfig/${productId}`).get();
      const groupConfig = gc.exists ? (gc.data() as Record<string, unknown>) : null;
      return toPublicProductDetail(product, groupConfig);
    }
    return toPublicProductDetail(product, null);
  }

  /**
   * 공개 상품의 옵션 선택지별 남은 수량. 손님 옵션 시트가 열릴 때 부른다(상품 상세는 캐시될 수 있어 따로 둔다).
   * 재고 품목에 연결된 선택지만 돌려주고, 다른 매장 품목을 가리키면 0개로 본다(주문도 막힌다).
   * 실제 재고 수는 공개하지 않도록 옵션 시트가 한 번에 담을 수 있는 수(99)까지만 알려 준다.
   */
  async getOptionAvailability(productId: string): Promise<ProductOptionAvailability> {
    const product = await this.loadPublicProduct(productId);
    const groups = Array.isArray(product['options'])
      ? (product['options'] as Array<{ choices?: Array<{ id?: unknown; stockId?: unknown }> }>)
      : [];
    const linked = groups
      .flatMap((group) => (Array.isArray(group.choices) ? group.choices : []))
      .filter(
        (choice): choice is { id: string; stockId: string } =>
          typeof choice.id === 'string' && typeof choice.stockId === 'string' && choice.stockId !== '',
      );
    const stockIds = [...new Set(linked.map((choice) => choice.stockId))];
    const snaps = await Promise.all(
      stockIds.map((id) => this.firestore.doc(optionStockPath(id)).get()),
    );
    const remainingByStock = new Map(
      stockIds.map((id, index) => {
        const data = snaps[index].exists ? snaps[index].data() : undefined;
        return [
          id,
          data && data['storeId'] === product['storeId'] ? optionStockRemaining(data) : 0,
        ] as const;
      }),
    );
    return {
      choices: linked.map((choice) => ({
        choiceId: choice.id,
        remainingQuantity: Math.min(
          remainingByStock.get(choice.stockId) ?? 0,
          PUBLIC_OPTION_REMAINING_CAP,
        ),
      })),
    };
  }

  /** 공개해도 되는 상품만 읽는다(숨김·테스트 상품, 치운 가게 상품은 없는 상품과 같게 404). */
  private async loadPublicProduct(productId: string): Promise<Record<string, unknown>> {
    const snap = await this.firestore.doc(`products/${productId}`).get();
    if (!snap.exists) throw new NotFoundException('상품을 찾을 수 없습니다.');
    const product = snap.data()! as Record<string, unknown>;
    if (
      !isPubliclyVisibleProduct(product) ||
      (typeof product['storeId'] === 'string' && (await this.isArchivedStoreId(product['storeId'])))
    ) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    return product;
  }

  private async isArchivedStoreId(storeId: string): Promise<boolean> {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    return snap.exists && isArchivedStore(snap.data());
  }

  // 가게 단위 공개 조회 입구. 치운 가게는 404, 문서가 없는 가게는 지금처럼 빈 결과·기본값을 돌려준다.
  private async assertPublicStore(storeId: string) {
    if (await this.isArchivedStoreId(storeId)) {
      throw new NotFoundException('스토어를 찾을 수 없습니다.');
    }
  }

  // 목록에 나온 상품의 가게 문서를 가게마다 한 번씩만 읽어 치운 가게 id를 모은다.
  private async readArchivedStoreIds(storeIds: unknown[]): Promise<Set<string>> {
    const unique = [...new Set(storeIds.filter((id): id is string => typeof id === 'string' && id !== ''))];
    const archived = await Promise.all(unique.map((id) => this.isArchivedStoreId(id)));
    return new Set(unique.filter((_, index) => archived[index]));
  }

  private async assertSellerOwnsStore(storeId: string, sellerId: string, role?: string) {
    if (role === 'admin') return;
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()!['ownerId'] !== sellerId) {
      throw new ForbiddenException('권한이 없습니다.');
    }
  }
}
