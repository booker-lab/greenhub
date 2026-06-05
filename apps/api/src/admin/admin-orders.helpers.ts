import { NotFoundException } from '@nestjs/common';
import { toIsoCursor } from './admin-settlements.helpers';
import type { QueryAdminOrdersDto } from './dto/admin.dto';

const ADMIN_ORDERS_DEFAULT_LIMIT = 50;

type FirestoreLike = {
  collection: (name: string) => any;
  doc: (path: string) => any;
  Timestamp: {
    fromDate: (date: Date) => unknown;
  };
};

type FirestoreDoc = {
  exists?: boolean;
  id?: string;
  data: () => Record<string, unknown> | undefined;
};

export async function getOrdersPage(firestore: FirestoreLike, dto: QueryAdminOrdersDto) {
  let query = firestore.collection('orders') as any;

  if (dto.storeId) {
    query = query.where('storeId', '==', dto.storeId);
  }
  if (dto.status) {
    query = query.where('status', '==', dto.status);
  }

  const sortDirection = dto.sort === 'createdAt_asc' ? 'asc' : 'desc';
  const limit = dto.limit ?? ADMIN_ORDERS_DEFAULT_LIMIT;
  if (dto.page) {
    const total = await getQueryCount(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    query = query
      .orderBy('createdAt', sortDirection)
      .offset((dto.page - 1) * limit)
      .limit(limit);
    const snap = await query.get();

    return {
      orders: snap.docs.map((d: FirestoreDoc) => d.data()),
      total,
      page: dto.page,
      pageSize: limit,
      totalPages,
      hasPrevious: dto.page > 1,
      hasNext: dto.page < totalPages,
      nextCursor: null,
    };
  }

  query = query.orderBy('createdAt', sortDirection);
  if (dto.cursor) {
    query = query.startAfter(firestore.Timestamp.fromDate(new Date(dto.cursor)));
  }
  query = query.limit(limit + 1);
  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);
  const nextDoc = snap.docs.length > limit ? docs.at(-1) : null;

  return {
    orders: docs.map((d: FirestoreDoc) => d.data()),
    total: docs.length,
    nextCursor: nextDoc ? toIsoCursor(nextDoc.data()?.createdAt) : null,
  };
}

async function getQueryCount(query: any): Promise<number> {
  const countSnap = await query.count().get();
  const count = countSnap.data()?.count;
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
}

export async function getAdminOrderDetail(firestore: FirestoreLike, orderId: string) {
  const orderSnap = await firestore.doc(`orders/${orderId}`).get();
  if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

  const order = orderSnap.data();
  if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
  const storeId = stringOrNull(order.storeId);
  const userId = stringOrNull(order.userId);

  const [storeSnap, buyerSnap, paymentSnap] = await Promise.all([
    storeId ? firestore.doc(`stores/${storeId}`).get() : Promise.resolve(null),
    userId ? firestore.doc(`users/${userId}`).get() : Promise.resolve(null),
    firestore.doc(`payments/${orderId}`).get(),
  ]);

  return {
    order,
    store: toEntity(storeSnap, storeId, ['name', 'ownerId', 'status', 'commissionRate']),
    buyer: sanitizeUser(toEntity(buyerSnap, userId, ['name', 'email', 'phone', 'role'])),
    payment: paymentSnap?.exists ? { id: orderId, ...(paymentSnap.data() ?? {}) } : null,
    items: [
      {
        productId: order.productId ?? null,
        productName: order.productName ?? null,
        quantity: numberOrNull(order.quantity),
        totalAmount: numberOrNull(order.totalAmount),
      },
    ],
    timeline: buildOrderTimeline(order),
  };
}

function toEntity(
  snap: FirestoreDoc | null,
  fallbackId: string | null,
  keys: string[],
): Record<string, unknown> | null {
  if (!snap?.exists) return fallbackId ? { id: fallbackId } : null;
  const data = snap.data() ?? {};
  const entity: Record<string, unknown> = { id: fallbackId ?? snap.id };
  for (const key of keys) {
    if (key in data) entity[key] = data[key];
  }
  return entity;
}

function sanitizeUser(user: Record<string, unknown> | null) {
  if (!user) return null;
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function buildOrderTimeline(order: Record<string, unknown>) {
  const timeline = [
    { label: '주문 생성', status: 'PENDING', at: order.createdAt ?? null },
    { label: '준비 예정 등록', status: 'PREPARING', at: order.preparedAt ?? null },
  ];

  if (order.status === 'CANCELLED') {
    timeline.push({
      label: '취소 처리',
      status: 'CANCELLED',
      at: order.updatedAt ?? order.createdAt ?? null,
    });
  } else if (order.updatedAt) {
    timeline.push({
      label: '최근 상태 갱신',
      status: String(order.status ?? ''),
      at: order.updatedAt,
    });
  }

  return timeline.filter((event) => Boolean(event.at));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
