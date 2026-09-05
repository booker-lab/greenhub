import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import type {
  CopySaleRoundDto,
  CreateSaleRoundDto,
  UpdateSaleRoundDto,
  UpdateSaleRoundStatusDto,
} from './dto/sale-round.dto';
import { assertScheduleOrder as assertCanonicalScheduleOrder } from './sale-round-state.contract';
import { SaleRoundStateService } from './sale-round-state.service';

type RoundWithItems = SaleRound & { items: SaleRoundItem[] };

const PUBLIC_SALE_ROUND_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED', 'COMPLETED'] as const;

function isPublicSaleRoundStatus(status: unknown): status is (typeof PUBLIC_SALE_ROUND_STATUSES)[number] {
  return (PUBLIC_SALE_ROUND_STATUSES as readonly unknown[]).includes(status);
}

@Injectable()
export class SaleRoundsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly roundState: SaleRoundStateService,
  ) {}
  async listSellerRounds(storeId: string, requesterId: string, role: string) {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    const snap = await this.firestore
      .collection('saleRounds')
      .where('storeId', '==', storeId)
      .get();
    const rounds = snap.docs.map((doc: any) => this.normalizeRound(doc.data() as SaleRound));
    return {
      items: rounds.sort((a, b) => this.dateMillis(b.createdAt) - this.dateMillis(a.createdAt)),
    };
  }
  async listPublicRounds(storeId: string) {
    await this.assertPublicRoundStore(storeId);
    const snap = await this.firestore
      .collection('saleRounds')
      .where('storeId', '==', storeId)
      .where('status', 'in', PUBLIC_SALE_ROUND_STATUSES)
      .get();
    const rounds = await Promise.all(
      snap.docs.map(async (doc: any) => {
        const storedRound = doc.data() as Record<string, any>;
        this.assertPublicRoundBoundary(storeId, storedRound);
        const round = await this.refreshRoundStatus(storeId, doc.id);
        return round.storeId === storeId && isPublicSaleRoundStatus(round.status) ? round : null;
      }),
    );
    return { items: rounds.filter((round): round is SaleRound => round !== null) };
  }
  async getRound(
    storeId: string,
    roundId: string,
    requesterId: string,
    role: string,
  ): Promise<RoundWithItems> {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    return this.getRoundWithItems(storeId, roundId);
  }
  private async getRoundWithItems(storeId: string, roundId: string): Promise<RoundWithItems> {
    const round = await this.refreshRoundStatus(storeId, roundId);
    const items = await this.getRoundItems(roundId, storeId);
    return { ...round, items };
  }
  async getPublicRound(storeId: string, roundId: string): Promise<RoundWithItems> {
    await this.assertPublicRoundStore(storeId);
    const storedRound = await this.getStoredRound(storeId, roundId);
    this.assertPublicRoundBoundary(storeId, storedRound);
    const round = await this.getRoundWithItems(storeId, roundId);
    this.assertPublicRoundBoundary(storeId, round);
    return round;
  }
  async createRound(
    storeId: string,
    requesterId: string,
    role: string,
    dto: CreateSaleRoundDto,
  ): Promise<RoundWithItems> {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    this.assertScheduleOrder(dto.schedule);
    const now = this.firestore.Timestamp.now();
    const roundId = uuidv4();
    const itemDocs = await this.buildItemDocs(storeId, roundId, dto.items, now);
    const round: SaleRound = {
      id: roundId,
      storeId,
      name: dto.name,
      status: 'DRAFT',
      closeReason: null,
      cancellation: null,
      schedule: dto.schedule,
      deliveryRegion: dto.deliveryRegion,
      limits: dto.limits,
      counters: this.emptyCounters(),
      carrotLandingUrl: dto.carrotLandingUrl ?? null,
      cancelledAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    } as unknown as SaleRound;

    await this.writeTransaction(async (tx) => {
      tx.set(this.firestore.doc(`saleRounds/${roundId}`), round);
      for (const item of itemDocs) {
        tx.set(this.firestore.doc(`saleRoundItems/${item.id}`), item);
      }
    });

    return {
      ...this.normalizeRound(round),
      items: itemDocs.map((item) => this.normalizeItem(item)),
    };
  }
  async updateRound(
    storeId: string,
    roundId: string,
    requesterId: string,
    role: string,
    dto: UpdateSaleRoundDto,
  ): Promise<RoundWithItems> {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    if (dto.schedule) this.assertScheduleOrder(dto.schedule);
    const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
    let result: RoundWithItems | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const roundSnap = await tx.get(roundRef);
      if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('회차를 찾을 수 없습니다.');
      }
      const round = roundSnap.data() as SaleRound;
      this.assertRoundEditable(round);
      const currentItems = await this.getRoundItemsInTransaction(tx, roundId, storeId);
      const now = this.firestore.Timestamp.now();
      const nextItems = dto.items
        ? await this.buildItemDocsInTransaction(tx, storeId, roundId, dto.items, now)
        : null;
      if ((nextItems || dto.limits !== undefined) && this.hasRoundUsage(round, currentItems)) {
        throw new ConflictException('예약 또는 주문이 사용 중인 회차 상품과 한도는 수정할 수 없습니다.');
      }

      const update: Record<string, unknown> = { updatedAt: now };
      if (dto.name !== undefined) update['name'] = dto.name;
      if (dto.schedule !== undefined) update['schedule'] = dto.schedule;
      if (dto.deliveryRegion !== undefined) update['deliveryRegion'] = dto.deliveryRegion;
      if (dto.limits !== undefined) update['limits'] = dto.limits;
      if (dto.carrotLandingUrl !== undefined) update['carrotLandingUrl'] = dto.carrotLandingUrl;

      tx.update(roundRef, update);
      if (nextItems) {
        for (const item of currentItems) {
          tx.delete(this.firestore.doc(`saleRoundItems/${item.id}`));
        }
        for (const item of nextItems) {
          tx.set(this.firestore.doc(`saleRoundItems/${item.id}`), item);
        }
      }
      result = this.normalizeRoundWithItems({
        ...round,
        ...update,
        items: nextItems ?? currentItems,
      } as RoundWithItems);
    });

    return result!;
  }
  async copyRound(
    storeId: string,
    requesterId: string,
    role: string,
    dto: CopySaleRoundDto,
  ): Promise<RoundWithItems> {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    this.assertScheduleOrder(dto.schedule);
    const source = await this.getRoundWithItems(storeId, dto.sourceRoundId);
    const itemInputs = source.items.map((item) => ({
      productId: item.productId,
      roundPrice: item.roundPrice,
      saleLimitQuantity: item.saleLimitQuantity,
      displayOrder: item.displayOrder,
    }));
    return this.createRound(storeId, requesterId, role, {
      name: dto.name,
      schedule: dto.schedule,
      deliveryRegion: source.deliveryRegion,
      limits: source.limits,
      items: itemInputs,
      carrotLandingUrl: dto.carrotLandingUrl ?? source.carrotLandingUrl ?? undefined,
    });
  }
  async updateStatus(
    storeId: string,
    roundId: string,
    requesterId: string,
    role: string,
    dto: UpdateSaleRoundStatusDto,
  ) {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    if (dto.status === 'COMPLETED') {
      return this.roundState
        .complete({
          storeId,
          roundId,
        })
        .then((value) => this.normalizeRound(value));
    }
    if (dto.status === 'CANCELLED') {
      return this.roundState
        .cancel({
          storeId,
          roundId,
          reason: '판매 회차 취소',
        })
        .then((value) => this.normalizeRound(value));
    }
    const result = await this.roundState.updateStatus({
      storeId,
      roundId,
      nextStatus: dto.status,
    });
    return this.normalizeRound(result);
  }
  async refreshRoundStatus(storeId: string, roundId: string): Promise<SaleRound> {
    return this.normalizeRound(await this.roundState.refreshStatus(storeId, roundId));
  }
  async completeRound(
    storeId: string,
    roundId: string,
    requesterId: string,
    role: string,
  ): Promise<SaleRound> {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    return this.normalizeRound(
      await this.roundState.complete({ storeId, roundId }),
    );
  }
  private async assertSellerOwnsStore(storeId: string, requesterId: string, role: string) {
    if (role === 'admin') return;
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()?.['ownerId'] !== requesterId) {
      throw new ForbiddenException('해당 스토어의 회차를 관리할 권한이 없습니다.');
    }
  }
  private async assertPublicRoundStore(storeId: string) {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()?.['salesMode'] !== 'round_direct') {
      throw new NotFoundException('공개 회차를 찾을 수 없습니다.');
    }
  }
  private assertPublicRoundBoundary(storeId: string, round: Record<string, any>) {
    if (round['storeId'] !== storeId || !isPublicSaleRoundStatus(round['status'])) {
      throw new NotFoundException('공개 회차를 찾을 수 없습니다.');
    }
  }
  private async getStoredRound(storeId: string, roundId: string): Promise<SaleRound> {
    const snap = await this.firestore.doc(`saleRounds/${roundId}`).get();
    if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    return snap.data() as SaleRound;
  }
  private async getRoundItems(roundId: string, storeId: string): Promise<SaleRoundItem[]> {
    const snap = await this.firestore
      .collection('saleRoundItems')
      .where('roundId', '==', roundId)
      .get();
    return snap.docs
      .map((doc: any) => this.normalizeItem(doc.data() as SaleRoundItem))
      .filter((item) => item.storeId === storeId)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  private async getRoundItemsInTransaction(
    tx: any,
    roundId: string,
    storeId: string,
  ): Promise<SaleRoundItem[]> {
    const snap = await tx.get(
      this.firestore.collection('saleRoundItems').where('roundId', '==', roundId),
    );
    return snap.docs
      .map((doc: any) => {
        const data = doc.data() as SaleRoundItem;
        return this.normalizeItem({ ...data, id: data.id ?? doc.id });
      })
      .filter((item) => item.storeId === storeId)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }
  private normalizeRound(round: SaleRound): SaleRound {
    const normalized = { ...round } as unknown as Record<string, any>;
    for (const key of ['createdAt', 'updatedAt', 'cancelledAt', 'completedAt']) {
      normalized[key] = this.toIsoOrNull(normalized[key]);
    }
    if (normalized['cancellation']) {
      normalized['cancellation'] = {
        ...normalized['cancellation'],
        updatedAt: this.toIsoOrNull(normalized['cancellation']['updatedAt']),
        completedAt: this.toIsoOrNull(normalized['cancellation']['completedAt']),
      };
    }
    normalized['schedule'] = Object.fromEntries(
      Object.entries(normalized['schedule'] ?? {}).map(([key, value]) => [
        key,
        key === 'timezone' ? value : this.toIsoOrNull(value),
      ]),
    );
    return normalized as SaleRound;
  }
  private normalizeItem(item: SaleRoundItem): SaleRoundItem {
    return {
      ...item,
      createdAt: this.toIsoOrNull(item.createdAt)!,
      updatedAt: this.toIsoOrNull(item.updatedAt)!,
    };
  }
  private normalizeRoundWithItems(round: RoundWithItems): RoundWithItems {
    return {
      ...this.normalizeRound(round),
      items: round.items.map((item) => this.normalizeItem(item)),
    };
  }
  private toIsoOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  private dateMillis(value: unknown) {
    const normalized = this.toIsoOrNull(value);
    return normalized ? new Date(normalized).getTime() : 0;
  }

  private async buildItemDocs(
    storeId: string,
    roundId: string,
    items: Array<{
      productId: string;
      roundPrice: number;
      saleLimitQuantity: number;
      displayOrder: number;
    }>,
    now: unknown,
  ): Promise<SaleRoundItem[]> {
    const docs: SaleRoundItem[] = [];
    for (const item of items) {
      const snap = await this.firestore.doc(`products/${item.productId}`).get();
      if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      }
      const product = snap.data()!;
      docs.push({
        id: uuidv4(),
        roundId,
        storeId,
        productId: item.productId,
        productNameSnapshot: product['name'],
        productImageUrlSnapshot: Array.isArray(product['images']) ? product['images'][0] : null,
        roundPrice: item.roundPrice,
        saleLimitQuantity: item.saleLimitQuantity,
        reservedQuantity: 0,
        orderedQuantity: 0,
        displayOrder: item.displayOrder,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      } as unknown as SaleRoundItem);
    }
    return docs;
  }

  private async buildItemDocsInTransaction(
    tx: any,
    storeId: string,
    roundId: string,
    items: Array<{
      productId: string;
      roundPrice: number;
      saleLimitQuantity: number;
      displayOrder: number;
    }>,
    now: unknown,
  ): Promise<SaleRoundItem[]> {
    const productSnaps = await Promise.all(
      items.map((item) => tx.get(this.firestore.doc(`products/${item.productId}`))),
    );
    return items.map((item, index) => {
      const snap = productSnaps[index];
      if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      }
      const product = snap.data()!;
      return {
        id: uuidv4(),
        roundId,
        storeId,
        productId: item.productId,
        productNameSnapshot: product['name'],
        productImageUrlSnapshot: Array.isArray(product['images']) ? product['images'][0] : null,
        roundPrice: item.roundPrice,
        saleLimitQuantity: item.saleLimitQuantity,
        reservedQuantity: 0,
        orderedQuantity: 0,
        displayOrder: item.displayOrder,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      } as unknown as SaleRoundItem;
    });
  }

  private assertRoundEditable(round: SaleRound) {
    if (!['DRAFT', 'SCHEDULED'].includes(round.status) || round.cancellation != null) {
      throw new ConflictException('작성 중 또는 판매 예정인 미사용 회차만 수정할 수 있습니다.');
    }
  }

  private hasRoundUsage(round: SaleRound, items: SaleRoundItem[]) {
    const counters = round.counters ?? ({} as SaleRound['counters']);
    return (
      (counters.reservedDeliveryAddresses ?? 0) > 0 ||
      (counters.reservedItemQuantity ?? 0) > 0 ||
      (counters.orderedDeliveryAddresses ?? 0) > 0 ||
      (counters.orderedItemQuantity ?? 0) > 0 ||
      items.some((item) => item.reservedQuantity > 0 || item.orderedQuantity > 0)
    );
  }

  private async updateRoundDoc(round: SaleRound, update: Record<string, unknown>) {
    await this.writeTransaction(async (tx) => {
      tx.update(this.firestore.doc(`saleRounds/${round.id}`), update);
    }, round);
  }

  private async writeTransaction(
    write: (tx: {
      set: (ref: unknown, data: unknown, options?: unknown) => void;
      update: (ref: unknown, data: unknown) => void;
      delete: (ref: unknown) => void;
    }) => Promise<void> | void,
    fallbackRound?: SaleRound,
  ) {
    if (typeof this.firestore.runTransaction === 'function') {
      await this.firestore.runTransaction(async (tx: any) => {
        if (fallbackRound) {
          const snap = await tx.get(this.firestore.doc(`saleRounds/${fallbackRound.id}`));
          if (!snap.exists || snap.data()?.['storeId'] !== fallbackRound.storeId) {
            throw new NotFoundException('회차를 찾을 수 없습니다.');
          }
        }
        await write(tx);
      });
      return;
    }

    const tx = {
      set: (ref: any, data: unknown, options?: unknown) => ref.set(data, options),
      update: (ref: any, data: unknown) => ref.update(data),
      delete: (ref: any) => ref.delete(),
    };
    await write(tx);
  }

  private assertScheduleOrder(schedule: {
    orderOpenAt: string;
    orderCloseAt: string;
    auctionAt: string;
    deliveryStartAt: string;
    deliveryEndAt: string;
  }) {
    assertCanonicalScheduleOrder(schedule);
  }

  private emptyCounters() {
    return {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    };
  }
}
