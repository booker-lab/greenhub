interface PageableOrder {
  id: string;
  orderNumber: string;
  storeId: string;
  status: string;
  createdAt: string;
}

export function buildPaginatedOrders<T extends PageableOrder>(base: T): T[] {
  return Array.from({ length: 30 }, (_, index) => ({
    ...base,
    id: `order-page-${String(index + 1).padStart(2, '0')}`,
    orderNumber: `ORD-PAGE-${String(index + 1).padStart(2, '0')}`,
    createdAt: `2026-05-${String(index + 1).padStart(2, '0')}T01:00:00.000Z`,
  }));
}

export function buildOrdersResponse<T extends PageableOrder>(
  requestUrl: string,
  orders: T[],
  paginate = false,
) {
  const url = new URL(requestUrl);
  const storeId = url.searchParams.get('storeId');
  const status = url.searchParams.get('status');
  const sort = url.searchParams.get('sort') ?? 'createdAt_desc';
  const filtered = orders
    .filter((order) => {
      if (storeId && order.storeId !== storeId) return false;
      if (status && order.status !== status) return false;
      return true;
    })
    .sort((a, b) =>
      sort === 'createdAt_asc'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
  const cursor = Number(url.searchParams.get('cursor') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? filtered.length);
  const page = Number(url.searchParams.get('page') ?? 0);
  const offset = page > 0 ? (page - 1) * limit : cursor;
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  return {
    orders: paginate ? filtered.slice(offset, offset + limit) : filtered,
    total: filtered.length,
    page: page || undefined,
    pageSize: page ? limit : undefined,
    totalPages: page ? totalPages : undefined,
    hasPrevious: page ? page > 1 : undefined,
    hasNext: page ? page < totalPages : undefined,
    nextCursor:
      !page && paginate && cursor + limit < filtered.length ? String(cursor + limit) : null,
  };
}
