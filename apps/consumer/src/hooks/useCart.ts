'use client';

import type { DeliveryMethod, SaleType } from '@greenhub/shared';
import { useCallback, useSyncExternalStore } from 'react';

const CART_KEY = 'greenhub_cart';
const MAX_CART_ID_LENGTH = 128;
const UNSAFE_CART_ID_CHARACTERS = '/?#\\';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  saleType: SaleType;
  deliveryMethod: DeliveryMethod;
  storeId: string;
  /** 일반 상품 한정 'YYYY-MM-DD' — 슬롯 검증 대상 주문만 채워짐. 옵셔널로 기존 장바구니와 하위 호환. */
  requestedDeliveryDate?: string;
  /** 회차 직배송 항목에만 존재하며 세 필드가 모두 유효할 때 회차 항목으로 취급한다. */
  roundId?: string;
  roundItemId?: string;
  roundPrice?: number;
}

export interface RoundCartItem extends CartItem {
  roundId: string;
  roundItemId: string;
  roundPrice: number;
}

export type CartItemInput = Omit<CartItem, 'quantity'> & { quantity?: number };

export type CartAddFailureReason = 'different_round' | 'incompatible_cart' | 'invalid_item';

export type CartAddResult =
  | { ok: true; items: CartItem[] }
  | { ok: false; reason: CartAddFailureReason; items: CartItem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCartIdentifier(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > MAX_CART_ID_LENGTH || value.trim() !== value) {
    return false;
  }
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || UNSAFE_CART_ID_CHARACTERS.includes(character);
  });
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readBaseCartItem(value: unknown): CartItem | null {
  if (
    !isRecord(value) ||
    !isCartIdentifier(value.productId) ||
    !isNonEmptyString(value.name) ||
    !isPrice(value.price) ||
    typeof value.image !== 'string' ||
    !isQuantity(value.quantity) ||
    (value.saleType !== 'normal' && value.saleType !== 'group') ||
    (value.deliveryMethod !== 'direct' &&
      value.deliveryMethod !== 'hub' &&
      value.deliveryMethod !== 'parcel') ||
    (value.requestedDeliveryDate !== undefined && typeof value.requestedDeliveryDate !== 'string')
  ) {
    return null;
  }

  return {
    productId: value.productId,
    name: value.name,
    price: value.price,
    image: value.image,
    quantity: value.quantity,
    saleType: value.saleType,
    deliveryMethod: value.deliveryMethod,
    // 과거 장바구니의 누락된 스토어 참조는 결제 전 가드가 수정 경로를 보여주도록 보존한다.
    storeId: typeof value.storeId === 'string' ? value.storeId : '',
    ...(value.requestedDeliveryDate ? { requestedDeliveryDate: value.requestedDeliveryDate } : {}),
  };
}

function hasRoundMetadata(value: Record<string, unknown>) {
  return 'roundId' in value || 'roundItemId' in value || 'roundPrice' in value;
}

function normalizeStoredCartItem(value: unknown): CartItem | null {
  const base = readBaseCartItem(value);
  if (!base || !isRecord(value)) return null;

  if (
    isCartIdentifier(value.roundId) &&
    isCartIdentifier(value.roundItemId) &&
    isPrice(value.roundPrice) &&
    value.roundPrice === base.price
  ) {
    return {
      ...base,
      roundId: value.roundId,
      roundItemId: value.roundItemId,
      roundPrice: value.roundPrice,
    };
  }

  return base;
}

export function isRoundCartItem(item: CartItem | undefined): item is RoundCartItem {
  return (
    !!item &&
    isNonEmptyString(item.storeId) &&
    isCartIdentifier(item.roundId) &&
    isCartIdentifier(item.roundItemId) &&
    isPrice(item.roundPrice) &&
    item.roundPrice === item.price
  );
}

function normalizeCartArray(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return EMPTY_CART;

  const normalized = value
    .map((item) => normalizeStoredCartItem(item))
    .filter((item): item is CartItem => item !== null);
  const roundItems = normalized.filter(isRoundCartItem);

  if (roundItems.length === 0) return normalized;
  if (roundItems.length !== normalized.length) return EMPTY_CART;
  if (roundItems.some((item) => item.roundId !== roundItems[0]?.roundId)) return EMPTY_CART;
  return normalized;
}

export function parseCartSnapshot(raw: string | null): CartItem[] {
  if (!raw) return EMPTY_CART;
  try {
    return normalizeCartArray(JSON.parse(raw));
  } catch {
    return EMPTY_CART;
  }
}

function isSameCartItem(left: CartItem, right: CartItem) {
  if (isRoundCartItem(left) && isRoundCartItem(right)) {
    return (
      left.roundId === right.roundId &&
      left.roundItemId === right.roundItemId &&
      left.productId === right.productId
    );
  }
  return !isRoundCartItem(left) && !isRoundCartItem(right) && left.productId === right.productId;
}

export function addCartItem(currentValue: CartItem[], input: CartItemInput): CartAddResult {
  const current = normalizeCartArray(currentValue);
  const inputValue = { ...input, quantity: input.quantity ?? 1 };
  const item = normalizeStoredCartItem(inputValue);

  if (!item || (hasRoundMetadata(inputValue) && !isRoundCartItem(item))) {
    return { ok: false, reason: 'invalid_item', items: current };
  }

  const currentRoundItems = current.filter(isRoundCartItem);
  if (isRoundCartItem(item)) {
    if (currentRoundItems.length !== current.length) {
      return { ok: false, reason: 'incompatible_cart', items: current };
    }
    if (currentRoundItems.some((currentItem) => currentItem.roundId !== item.roundId)) {
      return { ok: false, reason: 'different_round', items: current };
    }
  } else if (currentRoundItems.length > 0) {
    return { ok: false, reason: 'incompatible_cart', items: current };
  }

  const existing = current.find((currentItem) => isSameCartItem(currentItem, item));
  if (!existing) return { ok: true, items: [...current, item] };

  const quantity = existing.quantity + item.quantity;
  if (!isQuantity(quantity)) {
    return { ok: false, reason: 'invalid_item', items: current };
  }
  return {
    ok: true,
    items: current.map((currentItem) =>
      isSameCartItem(currentItem, item) ? { ...currentItem, quantity } : currentItem,
    ),
  };
}

// SSR에서도 안전한 localStorage 외부 저장소
let listeners: Array<() => void> = [];
function emitChange() {
  listeners.forEach((listener) => {
    listener();
  });
}
function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
let cachedRaw: string | null = null;
let cachedSnapshot: CartItem[] = [];

function getSnapshot(): CartItem[] {
  if (typeof window === 'undefined') return EMPTY_CART;
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    cachedSnapshot = parseCartSnapshot(raw);
    return cachedSnapshot;
  } catch {
    cachedRaw = null;
    cachedSnapshot = EMPTY_CART;
    return EMPTY_CART;
  }
}
const EMPTY_CART: CartItem[] = [];
function getServerSnapshot(): CartItem[] {
  return EMPTY_CART;
}
function persist(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  emitChange();
}

export function useCart() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addItem = useCallback((item: CartItemInput): CartAddResult => {
    const current = getSnapshot();
    const result = addCartItem(current, item);
    if (result.ok) persist(result.items);
    return result;
  }, []);

  const removeItem = useCallback((productId: string) => {
    persist(getSnapshot().filter((i) => i.productId !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      persist(getSnapshot().filter((i) => i.productId !== productId));
      return;
    }
    persist(getSnapshot().map((i) => (i.productId === productId ? { ...i, quantity } : i)));
  }, []);

  const clearCart = useCallback(() => {
    persist([]);
  }, []);

  const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return { items, addItem, removeItem, updateQuantity, clearCart, totalAmount, itemCount };
}
