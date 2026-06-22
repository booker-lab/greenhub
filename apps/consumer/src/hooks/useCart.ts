'use client';

import type { DeliveryMethod, SaleType } from '@greenhub/shared';
import { useCallback, useSyncExternalStore } from 'react';

const CART_KEY = 'greenhub_cart';

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
}

// ─── External store for SSR-safe localStorage ─────────────────────
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
    cachedSnapshot = raw ? (JSON.parse(raw) as CartItem[]) : [];
    return cachedSnapshot;
  } catch {
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

// ─── Hook ─────────────────────────────────────────────────────────
export function useCart() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addItem = useCallback((item: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
    const current = getSnapshot();
    const existing = current.find((i) => i.productId === item.productId);
    if (existing) {
      persist(
        current.map((i) =>
          i.productId === item.productId
            ? { ...i, quantity: i.quantity + (item.quantity ?? 1) }
            : i,
        ),
      );
    } else {
      persist([...current, { ...item, quantity: item.quantity ?? 1 }]);
    }
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
