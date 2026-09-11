/**
 * Public catalog visibility — single semantic owner.
 *
 * Canonical public predicate (anonymous product APIs):
 *   isActive === true AND testOnly !== true
 *
 * All anonymous product reads (GET /products, GET /products/:id,
 * GET /stores/:storeId/products, GET /stores/:storeId/products/:productId)
 * must enforce this predicate and return only the explicit public projection.
 *
 * Seller owner/internal reads use the separate owner path and are NOT
 * filtered/projected here.
 */

export interface PublicContent {
  headline: string;
  description: string;
}

export interface PublicGroupSummary {
  currentQuantity: number;
  minQuantity: number;
  targetQuantity: number;
  recruitDeadline: string | null;
}

export interface PublicGroupConfig {
  productId: string;
  minQuantity: number;
  targetQuantity: number;
  maxPerPerson: number;
  recruitDeadline: string | null;
  currentQuantity: number;
  groupDeliveryDate: string | null;
  groupDeliveryMethod: 'direct' | 'parcel';
  deliveryFeeDiscount: number;
}

export function isPubliclyVisibleProduct(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  return data['isActive'] === true && data['testOnly'] !== true;
}

export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const seconds = (value as { seconds: number }).seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString();
  }
  return null;
}

function toIsoOrOriginal(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  const iso = toIsoOrNull(value);
  return iso ?? value;
}

export function toPublicGroupSummary(
  gc: Record<string, unknown>,
): PublicGroupSummary {
  return {
    currentQuantity: (gc['currentQuantity'] as number) ?? 0,
    minQuantity: (gc['minQuantity'] as number) ?? 0,
    targetQuantity: (gc['targetQuantity'] as number) ?? 0,
    recruitDeadline: toIsoOrNull(gc['recruitDeadline']),
  };
}

export function toPublicGroupConfig(
  gc: Record<string, unknown>,
): PublicGroupConfig {
  return {
    productId: String(gc['productId'] ?? ''),
    minQuantity: (gc['minQuantity'] as number) ?? 0,
    targetQuantity: (gc['targetQuantity'] as number) ?? 0,
    maxPerPerson: (gc['maxPerPerson'] as number) ?? 0,
    recruitDeadline: toIsoOrNull(gc['recruitDeadline']),
    currentQuantity: (gc['currentQuantity'] as number) ?? 0,
    groupDeliveryDate: toIsoOrNull(gc['groupDeliveryDate']),
    groupDeliveryMethod: gc['groupDeliveryMethod'] === 'parcel' ? 'parcel' : 'direct',
    deliveryFeeDiscount: (gc['deliveryFeeDiscount'] as number) ?? 0,
  };
}

function readColors(p: Record<string, unknown>): unknown[] {
  const selection = p['selection'] as Record<string, unknown> | undefined;
  if (Array.isArray(selection?.['colors'])) return selection['colors'] as unknown[];
  if (Array.isArray(p['colors'])) return p['colors'] as unknown[];
  return [];
}

function toPublicContent(
  content: unknown,
): PublicContent | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const c = content as Record<string, unknown>;
  if (typeof c['headline'] !== 'string' || typeof c['description'] !== 'string') {
    return undefined;
  }
  // Explicitly drop content.isEditedByUser (internal).
  return { headline: c['headline'] as string, description: c['description'] as string };
}

/**
 * Public list summary — allowlist only.
 * Never spreads the stored document.
 */
export function toPublicProductSummary(
  p: Record<string, unknown>,
  groupConfig?: Record<string, unknown> | null,
  opts: { includeStoreId?: boolean } = {},
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: p['id'],
    name: p['name'],
    price: p['price'],
    images: Array.isArray(p['images']) ? [(p['images'] as unknown[])[0]] : [],
    category: p['category'],
    colors: readColors(p),
    saleType: p['saleType'],
    isActive: p['isActive'],
  };
  if (opts.includeStoreId) summary['storeId'] = p['storeId'];
  if (p['saleType'] === 'group' && groupConfig) {
    summary['groupSummary'] = toPublicGroupSummary(groupConfig);
  }
  return summary;
}

/**
 * Public detail — allowlist only.
 * Drops: sellerNote, sellerOverride, content.isEditedByUser, testOnly,
 * internal timestamps (raw), groupProductConfig.isProcessed.
 */
export function toPublicProductDetail(
  p: Record<string, unknown>,
  groupConfig?: Record<string, unknown> | null,
): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    id: p['id'],
    storeId: p['storeId'],
    name: p['name'],
    images: Array.isArray(p['images']) ? p['images'] : [],
    price: p['price'],
    category: p['category'],
    saleType: p['saleType'],
    deliverySize: p['deliverySize'],
    isActive: p['isActive'],
    createdAt: toIsoOrOriginal(p['createdAt']),
    updatedAt: toIsoOrOriginal(p['updatedAt']),
  };
  if (p['varietyId'] !== undefined) detail['varietyId'] = p['varietyId'];
  if (p['selection'] !== undefined) detail['selection'] = p['selection'];
  // Legacy compat fields (non-sensitive).
  if (p['description'] !== undefined) detail['description'] = p['description'];
  if (p['colors'] !== undefined) detail['colors'] = p['colors'];
  const content = toPublicContent(p['content']);
  if (content) detail['content'] = content;
  if (groupConfig) {
    detail['groupConfig'] = toPublicGroupConfig(groupConfig);
  }
  return detail;
}

/**
 * Owner/internal detail — full fidelity for seller mutation/read flows.
 * No visibility filtering, no public projection. Timestamp normalization
 * for groupConfig dates only (matches historical behavior).
 */
export function toOwnerProductDetail(
  p: Record<string, unknown>,
  groupConfig?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!groupConfig) return { ...p };
  const gc: Record<string, unknown> = { ...groupConfig };
  const rd = gc['recruitDeadline'] as { toDate?: () => Date };
  const gd = gc['groupDeliveryDate'] as { toDate?: () => Date };
  if (typeof rd?.toDate === 'function') gc['recruitDeadline'] = rd.toDate().toISOString();
  if (typeof gd?.toDate === 'function') gc['groupDeliveryDate'] = gd.toDate().toISOString();
  return { ...p, groupConfig: gc };
}
