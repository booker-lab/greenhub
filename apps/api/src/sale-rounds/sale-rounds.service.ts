import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SaleRound, SaleRoundItem, SaleRoundStatus } from '@greenhub/shared';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { PaymentsService } from '../payments/payments.service';
import type {
  CopySaleRoundDto,
  CreateSaleRoundDto,
  UpdateSaleRoundDto,
  UpdateSaleRoundStatusDto,
} from './dto/sale-round.dto';

type RoundWithItems = SaleRound & { items: SaleRoundItem[] };

@Injectable()
export class SaleRoundsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
  ) {}
  async listSellerRounds(storeId: string) {
    const snap = await this.firestore
      .collection('saleRounds')
      .where('storeId', '==', storeId)
      .get();
    const rounds = snap.docs.map((doc: any) => this.normalizeRound(doc.data() as SaleRound));
    return { items: rounds.sort((a, b) => this.dateMillis(b.createdAt) - this.dateMillis(a.createdAt)) };
  }
  async listPublicRounds(storeId: string) {
    const snap = await this.firestore
      .collection('saleRounds')
      .where('storeId', '==', storeId)
      .where('status', 'in', ['SCHEDULED', 'OPEN', 'CLOSED', 'COMPLETED'])
      .get();
    const rounds = await Promise.all(
      snap.docs.map(async (doc: any) => this.refreshRoundStatus(storeId, doc.data()['id'])),
    );
    return { items: rounds.filter((round) => round.status !== 'DRAFT') };
  }
  async getRound(storeId: string, roundId: string): Promise<RoundWithItems> {
    const round = await this.refreshRoundStatus(storeId, roundId);
    const items = await this.getRoundItems(roundId);
    return { ...round, items };
  }
  async getPublicRound(storeId: string, roundId: string): Promise<RoundWithItems> {
    const round = await this.getRound(storeId, roundId);
    if (round.status === 'DRAFT' || round.status === 'CANCELLED') {
      throw new NotFoundException('공개 회차를 찾을 수 없습니다.');
    }
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

    return { ...this.normalizeRound(round), items: itemDocs.map((item) => this.normalizeItem(item)) };
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
    const round = await this.getStoredRound(storeId, roundId);
    if (!['DRAFT', 'SCHEDULED'].includes(round.status)) {
      throw new ConflictException('작성 중 또는 판매 예정 회차만 수정할 수 있습니다.');
    }

    const now = this.firestore.Timestamp.now();
    const update: Record<string, unknown> = { updatedAt: now };
    if (dto.name !== undefined) update['name'] = dto.name;
    if (dto.schedule !== undefined) update['schedule'] = dto.schedule;
    if (dto.deliveryRegion !== undefined) update['deliveryRegion'] = dto.deliveryRegion;
    if (dto.limits !== undefined) update['limits'] = dto.limits;
    if (dto.carrotLandingUrl !== undefined) update['carrotLandingUrl'] = dto.carrotLandingUrl;

    const nextItems = dto.items ? await this.buildItemDocs(storeId, roundId, dto.items, now) : null;
    await this.writeTransaction(async (tx) => {
      tx.update(this.firestore.doc(`saleRounds/${roundId}`), update);
      if (nextItems) {
        const currentItems = await this.getRoundItems(roundId);
        for (const item of currentItems) {
          tx.delete(this.firestore.doc(`saleRoundItems/${item.id}`));
        }
        for (const item of nextItems) {
          tx.set(this.firestore.doc(`saleRoundItems/${item.id}`), item);
        }
      }
    });

    return this.normalizeRoundWithItems({
      ...round,
      ...update,
      items: nextItems ?? (await this.getRoundItems(roundId)),
    } as RoundWithItems);
  }
  async copyRound(
    storeId: string,
    requesterId: string,
    role: string,
    dto: CopySaleRoundDto,
  ): Promise<RoundWithItems> {
    await this.assertSellerOwnsStore(storeId, requesterId, role);
    this.assertScheduleOrder(dto.schedule);
    const source = await this.getRound(storeId, dto.sourceRoundId);
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
      return this.completeRound(storeId, roundId, requesterId, role, true);
    }
    if (dto.status === 'CANCELLED') {
      return this.cancelRound(storeId, roundId);
    }
    const round = await this.getStoredRound(storeId, roundId);
    if (round.status === dto.status) return this.normalizeRound(round);
    this.assertStatusTransition(round.status, dto.status);
    const now = this.firestore.Timestamp.now();
    const update: Record<string, unknown> = { status: dto.status, updatedAt: now };
    await this.updateRoundDoc(round, update);
    return this.normalizeRound({ ...round, ...update } as unknown as SaleRound);
  }
  async refreshRoundStatus(storeId: string, roundId: string): Promise<SaleRound> {
    const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('회차를 찾을 수 없습니다.');
      }
      const round = snap.data() as SaleRound;
      const nextStatus = this.resolveStatus(round);
      if (nextStatus === round.status) {
        result = round;
        return;
      }
      const update = { status: nextStatus, updatedAt: this.firestore.Timestamp.now() };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    return this.normalizeRound(result!);
  }
  async completeRound(
    storeId: string,
    roundId: string,
    requesterId: string,
    role: string,
    ownershipChecked = false,
  ): Promise<SaleRound> {
    if (!ownershipChecked) await this.assertSellerOwnsStore(storeId, requesterId, role);
    const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
    const ordersQuery = this.firestore.collection('orders').where('roundId', '==', roundId);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const [roundSnap, ordersSnap] = await Promise.all([tx.get(roundRef), tx.get(ordersQuery)]);
      if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('회차를 찾을 수 없습니다.');
      }
      const round = roundSnap.data() as SaleRound;
      if (round.status === 'COMPLETED') {
        result = round;
        return;
      }
      this.assertStatusTransition(round.status, 'COMPLETED');
      const hasUnfinishedOrder = ordersSnap.docs.some(
        (doc: any) => !['DELIVERED', 'REVIEWED', 'CANCELLED'].includes(doc.data()['status']),
      );
      if (round.counters.heldOrderCount > 0 || hasUnfinishedOrder) {
        throw new ConflictException('미완료 또는 배송 보류 주문이 남아 있어 회차를 완료할 수 없습니다.');
      }
      const now = this.firestore.Timestamp.now();
      const update = { status: 'COMPLETED' as const, completedAt: now, updatedAt: now };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    return this.normalizeRound(result!);
  }
  private async cancelRound(storeId: string, roundId: string): Promise<SaleRound> {
    const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
    const stored = await this.getStoredRound(storeId, roundId);
    if (stored.status === 'CANCELLED') return this.normalizeRound(stored);
    this.assertStatusTransition(stored.status, 'CANCELLED');

    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('회차를 찾을 수 없습니다.');
      }
      const fresh = snap.data() as SaleRound & { cancellationStatus?: string };
      if (fresh.status === 'CANCELLED') return;
      if (fresh.cancellationStatus === 'REFUNDING') {
        throw new ConflictException('회차 취소 환불이 이미 진행 중입니다.');
      }
      tx.update(roundRef, {
        cancellationStatus: 'REFUNDING',
        updatedAt: this.firestore.Timestamp.now(),
      });
    });

    try {
      const orders = await this.firestore
        .collection('orders')
        .where('roundId', '==', roundId)
        .get();
      const refundableOrders = orders.docs.filter(
        (doc: any) => !['PENDING', 'CANCELLED'].includes(doc.data()['status']),
      );
      for (const order of refundableOrders) {
        await this.payments.processRefundByOrderId(order.id, '판매 회차 취소');
      }
    } catch (error) {
      await roundRef.update({
        cancellationStatus: 'FAILED',
        updatedAt: this.firestore.Timestamp.now(),
      });
      throw error;
    }

    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException('회차를 찾을 수 없습니다.');
      }
      const fresh = snap.data() as SaleRound;
      if (fresh.status === 'CANCELLED') {
        result = fresh;
        return;
      }
      const now = this.firestore.Timestamp.now();
      const update = {
        status: 'CANCELLED' as const,
        cancellationStatus: 'COMPLETED',
        cancelledAt: now,
        updatedAt: now,
      };
      tx.update(roundRef, update);
      result = { ...fresh, ...update } as unknown as SaleRound;
    });
    return this.normalizeRound(result!);
  }
  private async assertSellerOwnsStore(storeId: string, requesterId: string, role: string) {
    if (role === 'admin') return;
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()?.['ownerId'] !== requesterId) {
      throw new ForbiddenException('해당 스토어의 회차를 관리할 권한이 없습니다.');
    }
  }
  private assertStatusTransition(current: SaleRoundStatus, next: SaleRoundStatus) {
    const transitions: Record<SaleRoundStatus, SaleRoundStatus[]> = {
      DRAFT: ['SCHEDULED', 'CANCELLED'],
      SCHEDULED: ['OPEN', 'CANCELLED'],
      OPEN: ['CLOSED', 'CANCELLED'],
      CLOSED: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    if (!transitions[current].includes(next)) {
      throw new ConflictException(`${current} → ${next} 회차 상태 전환은 허용되지 않습니다.`);
    }
  }
  private async getStoredRound(storeId: string, roundId: string): Promise<SaleRound> {
    const snap = await this.firestore.doc(`saleRounds/${roundId}`).get();
    if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    return snap.data() as SaleRound;
  }
  private async getRoundItems(roundId: string): Promise<SaleRoundItem[]> {
    const snap = await this.firestore
      .collection('saleRoundItems')
      .where('roundId', '==', roundId)
      .get();
    return snap.docs
      .map((doc: any) => this.normalizeItem(doc.data() as SaleRoundItem))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }
  private normalizeRound(round: SaleRound): SaleRound {
    const normalized = { ...round } as unknown as Record<string, any>;
    for (const key of ['createdAt', 'updatedAt', 'cancelledAt', 'completedAt']) {
      normalized[key] = this.toIsoOrNull(normalized[key]);
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

  private resolveStatus(round: SaleRound): SaleRoundStatus {
    if (!['SCHEDULED', 'OPEN'].includes(round.status)) return round.status;
    const now = Date.now();
    const closeAt = new Date(round.schedule.orderCloseAt).getTime();
    const openAt = new Date(round.schedule.orderOpenAt).getTime();
    if (now >= closeAt || this.isCapacityFull(round)) return 'CLOSED';
    if (round.status === 'SCHEDULED' && now >= openAt) return 'OPEN';
    return round.status;
  }

  private isCapacityFull(round: SaleRound) {
    const addressCount =
      round.counters.reservedDeliveryAddresses + round.counters.orderedDeliveryAddresses;
    const itemCount = round.counters.reservedItemQuantity + round.counters.orderedItemQuantity;
    return (
      addressCount >= round.limits.maxDeliveryAddresses || itemCount >= round.limits.maxItemQuantity
    );
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
    const orderOpenAt = new Date(schedule.orderOpenAt).getTime();
    const orderCloseAt = new Date(schedule.orderCloseAt).getTime();
    const auctionAt = new Date(schedule.auctionAt).getTime();
    const deliveryStartAt = new Date(schedule.deliveryStartAt).getTime();
    const deliveryEndAt = new Date(schedule.deliveryEndAt).getTime();
    if (
      !(orderOpenAt < orderCloseAt && orderCloseAt <= auctionAt && auctionAt <= deliveryStartAt) ||
      !(deliveryStartAt < deliveryEndAt)
    ) {
      throw new ConflictException('회차 일정 순서가 올바르지 않습니다.');
    }
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
