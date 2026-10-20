import type { SaleRound, SaleRoundItem } from '@greenhub/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirestoreService } from '../firestore/firestore.service';
import type {
  CopySaleRoundDto,
  CreateSaleRoundDto,
  UpdateSaleRoundDto,
  UpdateSaleRoundStatusDto,
} from './dto/sale-round.dto';
import {
  assertScheduleOrder as assertCanonicalScheduleOrder,
  resolveAutomaticState,
  timestampMillis,
} from './sale-round-state.contract';
import { SaleRoundStateService } from './sale-round-state.service';

type RoundWithItems = SaleRound & { items: SaleRoundItem[] };

const PUBLIC_SALE_ROUND_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED', 'COMPLETED'] as const;

function isPublicSaleRoundStatus(status: unknown): status is (typeof PUBLIC_SALE_ROUND_STATUSES)[number] {
  return (PUBLIC_SALE_ROUND_STATUSES as readonly unknown[]).includes(status);
}

/**
 * Public round-item visibility — single semantic owner.
 * HIDDEN is never public. ACTIVE / SOLD_OUT / CLOSED preserve the existing
 * contract (SOLD_OUT/CLOSED remain visible as sold-out/closed display;
 * consumer treats only ACTIVE in an OPEN round as purchasable).
 * Seller management reads must NOT use this predicate.
 */
export function isPubliclyVisibleRoundItem(
  item: Pick<SaleRoundItem, 'status'> | Record<string, unknown> | null | undefined,
): boolean {
  if (!item) return false;
  return (item as { status: unknown }).status !== 'HIDDEN';
}

/**
 * Public sale-round projection — explicit allowlist.
 * Stored document != public DTO: each public field is listed below, so a
 * future stored field is never auto-exposed to anonymous consumers.
 * Excluded as internal/operational: cancellation (lease/worker/order-internal
 * metadata: failedOrderId/ownerId/leaseId/leaseExpiresAt), counters,
 * cancelledAt/completedAt/createdAt/updatedAt.
 * Kept (consumer-verified public business facts): id/storeId/name,
 * effective status/closeReason, full schedule, deliveryRegion, limits,
 * carrotLandingUrl. Seller management reads must NOT use this projection.
 */
export interface PublicSaleRound {
  id: string;
  storeId: string;
  name: string;
  status: SaleRound['status'];
  closeReason: SaleRound['closeReason'];
  schedule: SaleRound['schedule'];
  deliveryRegion: SaleRound['deliveryRegion'];
  limits: SaleRound['limits'];
  carrotLandingUrl: string | null;
}

/**
 * Public sale-round item projection — explicit allowlist.
 * Excluded as internal: reservedQuantity/orderedQuantity (inventory signals),
 * createdAt/updatedAt. saleLimitQuantity stays public: it is the per-item
 * purchase constraint, not internal metadata. status is the effective public
 * status (see resolvePublicRoundItemStatus).
 */
export interface PublicSaleRoundItem {
  id: string;
  roundId: string;
  storeId: string;
  productId: string;
  productNameSnapshot: string;
  productImageUrlSnapshot: string | null;
  roundPrice: number;
  saleLimitQuantity: number;
  displayOrder: number;
  status: SaleRoundItem['status'];
  demand?: { remainingQuantity: number };
  /** 같은 가게·같은 상품이 직전 마감 회차에서 판 회차 가격. 근거가 없으면 키가 없다(card-discount). */
  previousRoundPrice?: number;
}

export type PublicSaleRoundWithItems = PublicSaleRound & {
  items: PublicSaleRoundItem[];
  demand?: { buyerCount: number };
};

export function toPublicSaleRound(round: SaleRound): PublicSaleRound {
  return {
    id: round.id,
    storeId: round.storeId,
    name: round.name,
    status: round.status,
    closeReason: round.closeReason,
    schedule: round.schedule,
    deliveryRegion: round.deliveryRegion,
    limits: round.limits,
    carrotLandingUrl: round.carrotLandingUrl,
  };
}

function itemCount(value: unknown): number | null {
  const count = value ?? 0;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

/**
 * Public sold-out display — computed at read time, never persisted.
 * An ACTIVE item whose checkout holds (15-minute reservations) plus paid
 * orders reached saleLimitQuantity cannot take even one more unit, so the
 * public read reports SOLD_OUT. When a hold is released the next read reports
 * ACTIVE again. Raw counts stay private; checkout/reservation validation is
 * unchanged and remains the authority. Malformed counters fail closed
 * (the order path rejects them too).
 */
export function resolvePublicRoundItemStatus(
  item: Pick<
    SaleRoundItem,
    'status' | 'saleLimitQuantity' | 'reservedQuantity' | 'orderedQuantity'
  >,
): SaleRoundItem['status'] {
  if (item.status !== 'ACTIVE') return item.status;
  const reserved = itemCount(item.reservedQuantity);
  const ordered = itemCount(item.orderedQuantity);
  const limit = itemCount(item.saleLimitQuantity);
  if (reserved === null || ordered === null || limit === null) return 'SOLD_OUT';
  return reserved + ordered >= limit ? 'SOLD_OUT' : 'ACTIVE';
}

export function toPublicSaleRoundItem(item: SaleRoundItem): PublicSaleRoundItem {
  return {
    id: item.id,
    roundId: item.roundId,
    storeId: item.storeId,
    productId: item.productId,
    productNameSnapshot: item.productNameSnapshot,
    productImageUrlSnapshot: item.productImageUrlSnapshot,
    roundPrice: item.roundPrice,
    saleLimitQuantity: item.saleLimitQuantity,
    displayOrder: item.displayOrder,
    status: resolvePublicRoundItemStatus(item),
  };
}

/**
 * 판매자가 수요 신호를 켠 스토어(showDemandSignals)에서만 붙이는 공개 수량 정보(벤치마킹 비교 기능).
 * 남은 수량은 판매 한도에서 결제 대기·주문 수량을 뺀 값이고, 구매 수는 주문한 배송지 수다.
 * 켜지 않은 스토어는 기존처럼 수량을 공개하지 않는다.
 */
export function remainingRoundItemQuantity(
  item: Pick<SaleRoundItem, 'saleLimitQuantity' | 'reservedQuantity' | 'orderedQuantity'>,
): number {
  const reserved = itemCount(item.reservedQuantity) ?? 0;
  const ordered = itemCount(item.orderedQuantity) ?? 0;
  const limit = itemCount(item.saleLimitQuantity) ?? 0;
  return Math.max(0, limit - reserved - ordered);
}

export function withDemandSignals(
  round: PublicSaleRoundWithItems,
  stored: Pick<SaleRound, 'counters'>,
  items: SaleRoundItem[],
): PublicSaleRoundWithItems {
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    ...round,
    demand: { buyerCount: itemCount(stored.counters?.orderedDeliveryAddresses) ?? 0 },
    items: round.items.map((item) => {
      const source = byId.get(item.id);
      return source ? { ...item, demand: { remainingQuantity: remainingRoundItemQuantity(source) } } : item;
    }),
  };
}

/**
 * 지난 회차 대비 가격 비교(card-discount)의 기준 회차 상태.
 * COMPLETED는 CLOSED에서만 넘어가는 다음 상태라(sale-round-state.contract.ts) 함께 마감 회차로 본다.
 * 소비자 앱의 "지난 회차"(useSaleRounds pastRounds)와 같은 범위다.
 */
const PREVIOUS_ROUND_STATUSES: ReadonlyArray<SaleRound['status']> = ['CLOSED', 'COMPLETED'];

function isoMillis(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

/**
 * 직전 마감 회차를 고른다. 회차 순서는 소비자 앱 관례(useSaleRounds sortLatestFirst)와 같이
 * schedule.orderOpenAt으로 매긴다. 지금 회차보다 주문 시작이 이른 마감 회차 가운데 가장 늦은 것을 고르고,
 * 시작 시각이 같으면 마감 시각이 늦은 것, 그다음 id 순으로 정해 결과가 흔들리지 않게 한다.
 * rounds는 실효 상태(applyEffectiveState)를 입힌 같은 가게의 회차여야 한다.
 */
export function selectPreviousClosedRound(
  current: Pick<SaleRound, 'id' | 'storeId' | 'schedule'>,
  rounds: ReadonlyArray<Pick<SaleRound, 'id' | 'storeId' | 'status' | 'schedule'>>,
): Pick<SaleRound, 'id' | 'storeId' | 'status' | 'schedule'> | null {
  const currentOpen = isoMillis(current.schedule?.orderOpenAt);
  if (currentOpen === null) return null;
  const candidates = rounds.flatMap((round) => {
    if (round.id === current.id || round.storeId !== current.storeId) return [];
    if (!PREVIOUS_ROUND_STATUSES.includes(round.status)) return [];
    const open = isoMillis(round.schedule?.orderOpenAt);
    if (open === null || open >= currentOpen) return [];
    return [{ round, open, close: isoMillis(round.schedule?.orderCloseAt) ?? 0 }];
  });
  candidates.sort(
    (a, b) => b.open - a.open || b.close - a.close || (a.round.id < b.round.id ? 1 : -1),
  );
  return candidates[0]?.round ?? null;
}

/**
 * 직전 마감 회차의 상품별 판매가를 지금 회차 상품에 previousRoundPrice로 붙인다.
 * 직전 회차에서도 공개된(HIDDEN이 아닌) 같은 가게의 상품만 근거로 쓰고,
 * 같은 상품이 여럿이면 진열 순서가 앞선 것을 쓴다.
 * 근거가 없는 상품은 키를 만들지 않는다.
 */
export function withPreviousRoundPrices(
  round: PublicSaleRoundWithItems,
  previousItems: ReadonlyArray<SaleRoundItem>,
): PublicSaleRoundWithItems {
  const priceByProduct = new Map<string, number>();
  const ordered = [...previousItems].sort((a, b) => a.displayOrder - b.displayOrder);
  for (const item of ordered) {
    if (item.storeId !== round.storeId || !isPubliclyVisibleRoundItem(item)) continue;
    if (priceByProduct.has(item.productId)) continue;
    const price = item.roundPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) continue;
    priceByProduct.set(item.productId, price);
  }
  if (priceByProduct.size === 0) return round;
  return {
    ...round,
    items: round.items.map((item) => {
      const previousRoundPrice = priceByProduct.get(item.productId);
      return previousRoundPrice === undefined ? item : { ...item, previousRoundPrice };
    }),
  };
}

/**
 * 공개 회차 묶음 응답(`?include=items`)에 싣는 지난 회차(마감·완료) 개수. 생략하면 기본값을 쓰고,
 * 숫자가 아니거나 상한을 넘으면 거부한다. 판매 예정·판매 중 회차는 개수와 상관없이 모두 싣는다.
 */
export const PUBLIC_PAST_ROUND_DEFAULT_LIMIT = 3;
export const PUBLIC_PAST_ROUND_MAX_LIMIT = 10;

export function resolvePublicPastRoundLimit(raw: unknown): number {
  if (raw === undefined) return PUBLIC_PAST_ROUND_DEFAULT_LIMIT;
  const value = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value > PUBLIC_PAST_ROUND_MAX_LIMIT) {
    throw new BadRequestException(
      `past는 0~${PUBLIC_PAST_ROUND_MAX_LIMIT} 사이의 정수여야 합니다.`,
    );
  }
  return value;
}

/**
 * 묶음 응답에 실을 회차를 최신순(schedule.orderOpenAt, 소비자 앱 sortLatestFirst와 같은 기준)으로 고른다.
 * 마감·완료 회차는 최신 pastLimit개만 남기고, 그 밖의 공개 회차(판매 예정·판매 중)는 모두 남긴다.
 * 회차가 쌓여도 응답 크기와 상품 조회 수가 늘지 않게 하는 경계다.
 */
export function selectPublicFeedRounds<T extends Pick<SaleRound, 'id' | 'status' | 'schedule'>>(
  rounds: ReadonlyArray<T>,
  pastLimit: number,
): T[] {
  const openMillis = (round: T) => isoMillis(round.schedule?.orderOpenAt) ?? 0;
  const latestFirst = [...rounds].sort(
    (a, b) => openMillis(b) - openMillis(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let pastCount = 0;
  return latestFirst.filter((round) => {
    if (!PREVIOUS_ROUND_STATUSES.includes(round.status)) return true;
    pastCount += 1;
    return pastCount <= pastLimit;
  });
}

function toPublicRoundItems(items: SaleRoundItem[]): PublicSaleRoundItem[] {
  // Preserve displayOrder sorting done by getRoundItems; HIDDEN filter first,
  // then explicit projection (same visibility predicate as before).
  return items
    .filter((item) => isPubliclyVisibleRoundItem(item))
    .map((item) => toPublicSaleRoundItem(item));
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
    // READ-ONLY: the list shows the same effective status as the public list
    // (orderOpenAt/orderCloseAt/capacity) without persisting it. Persisting
    // stays on the seller detail read and the write-side state machine.
    const nowMillis = timestampMillis(this.firestore.Timestamp.now());
    const rounds = snap.docs.map((doc: any) =>
      this.normalizeRound(this.applyEffectiveState(doc.data() as SaleRound, nowMillis)),
    );
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
    // READ-ONLY: public list must not persist automatic transitions.
    // Effective status is derived purely via resolveAutomaticState; storage
    // mutation stays on the authenticated write-side state machine.
    // List returns projected round summaries without items by design; item
    // visibility is enforced in getPublicRound via toPublicRoundItems
    // (same predicate) plus toPublicSaleRoundItem projection.
    const nowMillis = timestampMillis(this.firestore.Timestamp.now());
    const rounds = snap.docs.map((doc: any) => {
      const storedRound = doc.data() as SaleRound;
      this.assertPublicRoundBoundary(storeId, storedRound as unknown as Record<string, any>);
      const round = this.normalizeRound(this.applyEffectiveState(storedRound, nowMillis));
      return round.storeId === storeId && isPublicSaleRoundStatus(round.status)
        ? toPublicSaleRound(round)
        : null;
    });
    return { items: rounds.filter((round): round is PublicSaleRound => round !== null) };
  }
  /**
   * 공개 회차 묶음 응답: 판매 예정·판매 중 회차 전부와 최신 마감·완료 회차 pastLimit개를 상품까지 한 번에 준다.
   * 회차마다 상세를 따로 부르던 소비자 앱의 N+1을 없앤다. 회차별 내용(숨김 상품 제외·수요 신호·지난 회차
   * 대비 가격)은 getPublicRound와 같고, 회차 목록은 한 번만 읽어 직전 마감 회차 판정에도 함께 쓴다.
   * 같은 회차의 상품은 한 번만 읽는다. READ-ONLY: 실효 상태는 저장하지 않고 계산만 한다.
   */
  async listPublicRoundsWithItems(
    storeId: string,
    pastLimit: number,
  ): Promise<{ items: PublicSaleRoundWithItems[] }> {
    const store = await this.assertPublicRoundStore(storeId);
    const snap = await this.firestore
      .collection('saleRounds')
      .where('storeId', '==', storeId)
      .where('status', 'in', PUBLIC_SALE_ROUND_STATUSES)
      .get();
    const nowMillis = timestampMillis(this.firestore.Timestamp.now());
    const rounds = snap.docs.flatMap((doc: any) => {
      const storedRound = doc.data() as SaleRound;
      this.assertPublicRoundBoundary(storeId, storedRound as unknown as Record<string, any>);
      const round = this.normalizeRound(this.applyEffectiveState(storedRound, nowMillis));
      return round.storeId === storeId && isPublicSaleRoundStatus(round.status) ? [round] : [];
    });

    const itemReads = new Map<string, Promise<SaleRoundItem[]>>();
    const readItems = (roundId: string) => {
      let read = itemReads.get(roundId);
      if (!read) {
        read = this.getRoundItems(roundId, storeId);
        itemReads.set(roundId, read);
      }
      return read;
    };
    const showDemandSignals = store['showDemandSignals'] === true;
    const items = await Promise.all(
      selectPublicFeedRounds(rounds, pastLimit).map(async (round) => {
        const roundItems = await readItems(round.id);
        const projected = { ...toPublicSaleRound(round), items: toPublicRoundItems(roundItems) };
        const withDemand = showDemandSignals
          ? withDemandSignals(projected, round, roundItems)
          : projected;
        if (withDemand.items.length === 0) return withDemand;
        const previous = selectPreviousClosedRound(round, rounds);
        return previous
          ? withPreviousRoundPrices(withDemand, await readItems(previous.id))
          : withDemand;
      }),
    );
    return { items };
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
  private async getPublicRoundWithItems(
    storeId: string,
    roundId: string,
    showDemandSignals = false,
  ): Promise<PublicSaleRoundWithItems> {
    // READ-ONLY: derive effective status purely; never call refreshRoundStatus
    // (which persists via transaction) from the public path.
    const stored = await this.getStoredRound(storeId, roundId);
    const nowMillis = timestampMillis(this.firestore.Timestamp.now());
    const round = this.normalizeRound(this.applyEffectiveState(stored, nowMillis));
    const items = await this.getRoundItems(roundId, storeId);
    const projected = { ...toPublicSaleRound(round), items: toPublicRoundItems(items) };
    const withDemand = showDemandSignals ? withDemandSignals(projected, round, items) : projected;
    if (withDemand.items.length === 0) return withDemand;
    const previousItems = await this.getPreviousClosedRoundItems(round, nowMillis);
    return withPreviousRoundPrices(withDemand, previousItems);
  }
  /**
   * 지난 회차 대비 가격(card-discount)의 근거. 공개 회차 상세 한 번에 가게 회차 목록 1회 +
   * 직전 마감 회차의 상품 1회만 읽는다(직전 회차가 없으면 상품은 읽지 않는다).
   * 회차 목록 조회는 listPublicRounds와 같은 조건(storeId + status in)이라 새 색인이 필요 없다.
   * READ-ONLY: 실효 상태는 저장하지 않고 계산만 한다.
   */
  private async getPreviousClosedRoundItems(
    current: SaleRound,
    nowMillis: number,
  ): Promise<SaleRoundItem[]> {
    const snap = await this.firestore
      .collection('saleRounds')
      .where('storeId', '==', current.storeId)
      .where('status', 'in', PUBLIC_SALE_ROUND_STATUSES)
      .get();
    const rounds = snap.docs.map((doc: any) =>
      this.normalizeRound(this.applyEffectiveState(doc.data() as SaleRound, nowMillis)),
    );
    const previous = selectPreviousClosedRound(current, rounds);
    return previous ? this.getRoundItems(previous.id, current.storeId) : [];
  }
  async getPublicRound(storeId: string, roundId: string): Promise<PublicSaleRoundWithItems> {
    const store = await this.assertPublicRoundStore(storeId);
    const storedRound = await this.getStoredRound(storeId, roundId);
    this.assertPublicRoundBoundary(storeId, storedRound);
    const round = await this.getPublicRoundWithItems(
      storeId,
      roundId,
      store['showDemandSignals'] === true,
    );
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
    const roundId = randomUUID();
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
  private async assertPublicRoundStore(storeId: string): Promise<Record<string, unknown>> {
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()?.['salesMode'] !== 'round_direct') {
      throw new NotFoundException('공개 회차를 찾을 수 없습니다.');
    }
    return snap.data() ?? {};
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
  private applyEffectiveState(stored: SaleRound, nowMillis: number): SaleRound {
    // Pure automatic transition for public reads and the seller list. Reuses the single
    // write-side domain function without persisting (no transaction/write).
    // Preserves the full SaleRound response contract; only status/closeReason
    // are overlaid with the effective values.
    const next = resolveAutomaticState(
      stored as unknown as Parameters<typeof resolveAutomaticState>[0],
      nowMillis,
    );
    return { ...stored, status: next.status, closeReason: next.closeReason } as SaleRound;
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
        id: randomUUID(),
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
        id: randomUUID(),
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
