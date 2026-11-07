import type { FormDraft, ItemDraft, NumericValue } from './RoundForm.sections';

/** 회차 폼 임시저장(localStorage) 형식 버전. 형식을 바꾸면 올려서 옛 초안을 버린다. */
export const ROUND_DRAFT_VERSION = 1;
/** 입력이 멈춘 뒤 이만큼 지나면 임시저장한다. */
export const ROUND_DRAFT_SAVE_DELAY_MS = 500;
/** 이보다 오래된 초안은 일정·가격이 지났을 수 있어 복원하지 않고 버린다. */
export const ROUND_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const KEY_PREFIX = 'seller_round_draft';

export interface StoredRoundDraft {
  version: typeof ROUND_DRAFT_VERSION;
  /** 초안을 저장한 시각(ISO). */
  savedAt: string;
  /** 초안을 만들 때 기준이 된 서버 회차 updatedAt(ISO). 새 회차는 null. */
  baseUpdatedAt: string | null;
  draft: FormDraft;
}

export type RoundDraftResolution =
  /** 저장된 초안이 없거나 읽을 수 없다 — 서버 값(기본값)으로 시작한다. */
  | { kind: 'none' }
  /** 오래돼 버렸다 — 안내 없이 서버 값으로 시작한다. */
  | { kind: 'expired' }
  /** 서버 회차가 초안보다 나중에 바뀌어 버렸다 — 버린 사실을 안내한다. */
  | { kind: 'stale' }
  /** 초안을 복원한다. */
  | { kind: 'restore'; draft: FormDraft };

/** 가게와 회차(새 회차는 'new')별로 나눈 임시저장 키. */
export function roundDraftStorageKey(storeId: string, roundId: string | null): string {
  return `${KEY_PREFIX}:${encodeURIComponent(storeId)}:${roundId === null ? 'new' : encodeURIComponent(roundId)}`;
}

export function serializeRoundDraft(
  draft: FormDraft,
  savedAt: Date,
  baseUpdatedAt: string | null,
): string {
  const stored: StoredRoundDraft = {
    version: ROUND_DRAFT_VERSION,
    savedAt: savedAt.toISOString(),
    baseUpdatedAt,
    draft,
  };
  return JSON.stringify(stored);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumericValue(value: unknown): value is NumericValue {
  return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string';
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function readItem(value: unknown): ItemDraft | null {
  if (!isRecord(value)) return null;
  const { key, productId, name, roundPrice, saleLimitQuantity, displayOrder } = value;
  if (
    typeof key !== 'string' ||
    typeof productId !== 'string' ||
    typeof name !== 'string' ||
    !isNumericValue(roundPrice) ||
    !isNumericValue(saleLimitQuantity) ||
    !isNumericValue(displayOrder)
  ) {
    return null;
  }
  return { key, productId, name, roundPrice, saleLimitQuantity, displayOrder };
}

function readFormDraft(value: unknown): FormDraft | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const stringKeys = [
    'name',
    'orderOpenAt',
    'orderCloseAt',
    'auctionAt',
    'deliveryStartAt',
    'deliveryEndAt',
  ] as const;
  if (stringKeys.some((key) => typeof value[key] !== 'string')) return null;
  if (
    typeof value.deliveryRegionEnabled !== 'boolean' ||
    !isNumericValue(value.maxDeliveryAddresses) ||
    !isNumericValue(value.maxItemQuantity)
  ) {
    return null;
  }
  const items: ItemDraft[] = [];
  for (const rawItem of value.items) {
    const item = readItem(rawItem);
    if (!item) return null;
    items.push(item);
  }
  return {
    name: value.name as string,
    orderOpenAt: value.orderOpenAt as string,
    orderCloseAt: value.orderCloseAt as string,
    auctionAt: value.auctionAt as string,
    deliveryStartAt: value.deliveryStartAt as string,
    deliveryEndAt: value.deliveryEndAt as string,
    deliveryRegionEnabled: value.deliveryRegionEnabled,
    maxDeliveryAddresses: value.maxDeliveryAddresses,
    maxItemQuantity: value.maxItemQuantity,
    items,
  };
}

/** 저장된 문자열을 읽는다. 형식이 하나라도 어긋나면 null(복원하지 않음)이다. */
export function parseRoundDraft(raw: string | null): StoredRoundDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== ROUND_DRAFT_VERSION) return null;
  if (!isIsoTimestamp(parsed.savedAt)) return null;
  if (parsed.baseUpdatedAt !== null && !isIsoTimestamp(parsed.baseUpdatedAt)) return null;
  const draft = readFormDraft(parsed.draft);
  if (!draft) return null;
  return {
    version: ROUND_DRAFT_VERSION,
    savedAt: parsed.savedAt,
    baseUpdatedAt: parsed.baseUpdatedAt,
    draft,
  };
}

/**
 * 저장된 초안을 복원할지 판정한다.
 * - 오래된 초안(만료)은 버린다.
 * - 수정 화면: 서버 회차 updatedAt이 초안의 기준 updatedAt과 다르면 서버 값을 우선한다.
 *   저장 시각(savedAt)은 기기 시계 값이라 서버 시각과 비교하지 않고 만료 판정에만 쓴다.
 */
export function resolveRoundDraft(input: {
  stored: StoredRoundDraft | null;
  /** 수정 화면의 서버 회차 updatedAt. 새 회차는 null. */
  roundUpdatedAt: string | null;
  now: Date;
}): RoundDraftResolution {
  const { stored, roundUpdatedAt, now } = input;
  if (!stored) return { kind: 'none' };
  const savedAt = Date.parse(stored.savedAt);
  if (now.getTime() - savedAt > ROUND_DRAFT_MAX_AGE_MS) return { kind: 'expired' };
  if (roundUpdatedAt !== null) {
    const serverUpdatedAt = Date.parse(roundUpdatedAt);
    if (!Number.isFinite(serverUpdatedAt) || stored.baseUpdatedAt !== roundUpdatedAt) {
      return { kind: 'stale' };
    }
  }
  return { kind: 'restore', draft: stored.draft };
}

// 키 순서와 상관없이 비교하려고 배열로 고정한다.
function normalizeForCompare(draft: FormDraft) {
  return [
    draft.name,
    draft.orderOpenAt,
    draft.orderCloseAt,
    draft.auctionAt,
    draft.deliveryStartAt,
    draft.deliveryEndAt,
    draft.deliveryRegionEnabled,
    String(draft.maxDeliveryAddresses),
    String(draft.maxItemQuantity),
    draft.items.map((item) => [
      item.key,
      item.productId,
      item.name,
      String(item.roundPrice),
      String(item.saleLimitQuantity),
      String(item.displayOrder),
    ]),
  ];
}

/** 입력이 기준(서버 값·기본값)과 다른지 본다. 숫자 칸의 15와 '15'는 같은 값으로 본다. */
export function isRoundDraftDirty(draft: FormDraft, baseline: FormDraft): boolean {
  return (
    JSON.stringify(normalizeForCompare(draft)) !== JSON.stringify(normalizeForCompare(baseline))
  );
}
