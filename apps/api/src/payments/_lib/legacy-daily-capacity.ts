type LegacyOrder = Record<string, any>;

type Snapshot = {
  exists: boolean;
  data(): LegacyOrder | undefined;
};

type Transaction = {
  get(ref: unknown): Promise<Snapshot>;
  update(ref: unknown, data: Record<string, unknown>): void;
};

type FirestoreLike = {
  doc(path: string): unknown;
  Timestamp: { now(): unknown };
};

type CapacityState = {
  status: 'HELD' | 'RELEASED';
  date: string;
  quantity: number;
  updatedAt?: unknown;
  reason?: string;
};

export class LegacyDailyCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyDailyCapacityError';
  }
}

export function isLegacyDailyCapacityEligible(order: LegacyOrder): boolean {
  return (
    order['schemaVersion'] !== 2 &&
    order['saleType'] === 'normal' &&
    (order['deliveryMethod'] === 'direct' || order['deliveryMethod'] === 'hub')
  );
}

export function legacyDailyCapacityDateKey(order: LegacyOrder): string {
  const requestedDate = order['requestedDeliveryDate'];
  if (requestedDate !== undefined && requestedDate !== null && requestedDate !== '') {
    if (typeof requestedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      throw new LegacyDailyCapacityError('legacy requestedDeliveryDate 형식이 올바르지 않습니다.');
    }
    return requestedDate;
  }

  const createdAt = toDate(order['createdAt']);
  if (!createdAt) {
    throw new LegacyDailyCapacityError('legacy daily capacity 날짜를 확인할 수 없습니다.');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(createdAt);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values['year']}-${values['month']}-${values['day']}`;
}

export async function releaseLegacyDailyCapacityInTransaction(
  firestore: FirestoreLike,
  tx: Transaction,
  orderId: string,
  reason: string,
): Promise<'RELEASED' | 'ALREADY_RELEASED' | 'NOT_ELIGIBLE'> {
  const orderRef = firestore.doc(`orders/${orderId}`);
  const orderSnap = await tx.get(orderRef);
  if (!orderSnap.exists) return 'NOT_ELIGIBLE';

  const order = orderSnap.data() ?? {};
  if (!isLegacyDailyCapacityEligible(order)) return 'NOT_ELIGIBLE';

  const state = readCapacityState(order);
  if (state?.status === 'RELEASED') return 'ALREADY_RELEASED';

  const date = state?.date ?? legacyDailyCapacityDateKey(order);
  const quantity = state?.quantity ?? legacyQuantity(order);
  const capRef = firestore.doc(`dailyCaps/${order['storeId']}_${date}`);
  const capSnap = await tx.get(capRef);
  if (!capSnap.exists) {
    throw new LegacyDailyCapacityError(`legacy daily capacity 문서가 없습니다: ${date}`);
  }

  const cap = capSnap.data() ?? {};
  const usedSlots = finiteNumber(cap['usedSlots']);
  if (usedSlots < quantity) {
    throw new LegacyDailyCapacityError('legacy daily capacity 점유 상태가 이미 반환되었거나 손상되었습니다.');
  }

  const now = firestore.Timestamp.now();
  tx.update(capRef, { usedSlots: usedSlots - quantity });
  tx.update(orderRef, {
    legacyDailyCapacity: {
      status: 'RELEASED',
      date,
      quantity,
      updatedAt: now,
      reason,
    },
  });
  return 'RELEASED';
}

export async function reacquireLegacyDailyCapacityInTransaction(
  firestore: FirestoreLike,
  tx: Transaction,
  orderId: string,
  order: LegacyOrder,
): Promise<'REACQUIRED' | 'ALREADY_HELD' | 'NOT_ELIGIBLE'> {
  if (!isLegacyDailyCapacityEligible(order)) return 'NOT_ELIGIBLE';

  const orderRef = firestore.doc(`orders/${orderId}`);
  const freshSnap = await tx.get(orderRef);
  if (!freshSnap.exists) throw new LegacyDailyCapacityError('주문이 없어 legacy capacity를 재확보할 수 없습니다.');
  const freshOrder = freshSnap.data() ?? order;
  if (!isLegacyDailyCapacityEligible(freshOrder)) return 'NOT_ELIGIBLE';

  const state = readCapacityState(freshOrder);
  if (state?.status === 'HELD') return 'ALREADY_HELD';

  const date = state?.date ?? legacyDailyCapacityDateKey(freshOrder);
  const quantity = state?.quantity ?? legacyQuantity(freshOrder);
  const capRef = firestore.doc(`dailyCaps/${freshOrder['storeId']}_${date}`);
  const capSnap = await tx.get(capRef);
  if (!capSnap.exists) {
    throw new LegacyDailyCapacityError(`legacy daily capacity 문서가 없습니다: ${date}`);
  }

  const cap = capSnap.data() ?? {};
  const usedSlots = finiteNumber(cap['usedSlots']);
  const totalCap = finiteNumber(cap['totalCap']);
  if (usedSlots + quantity > totalCap) {
    throw new LegacyDailyCapacityError('legacy daily capacity를 재확보할 수 없습니다.');
  }

  const now = firestore.Timestamp.now();
  tx.update(capRef, { usedSlots: usedSlots + quantity });
  tx.update(orderRef, {
    legacyDailyCapacity: {
      status: 'HELD',
      date,
      quantity,
      updatedAt: now,
      reason: 'late_paid_reacquire',
    },
  });
  return 'REACQUIRED';
}

function readCapacityState(order: LegacyOrder): CapacityState | null {
  const value = order['legacyDailyCapacity'];
  if (!value || typeof value !== 'object') return null;
  if (value['status'] !== 'HELD' && value['status'] !== 'RELEASED') {
    throw new LegacyDailyCapacityError('legacy daily capacity 상태가 올바르지 않습니다.');
  }
  return {
    status: value['status'],
    date: value['date'],
    quantity: value['quantity'],
    updatedAt: value['updatedAt'],
    reason: value['reason'],
  };
}

function legacyQuantity(order: LegacyOrder): number {
  const quantity = finiteNumber(order['quantity']);
  if (quantity <= 0) {
    throw new LegacyDailyCapacityError('legacy daily capacity 수량이 올바르지 않습니다.');
  }
  return quantity;
}

function finiteNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new LegacyDailyCapacityError('legacy daily capacity 숫자 상태가 올바르지 않습니다.');
  }
  return number;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate(): Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
