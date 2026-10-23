import type { Product } from '@greenhub/shared';
import { isStoreProductsBackgroundRefresh } from './useStoreProducts.recovery';

/**
 * 매장별 상품 구독 공유소.
 * 홈·상품·준비 화면이 같은 매장 상품을 각자 구독하면 화면을 옮길 때마다 Firestore가 상품 문서를
 * 전부 다시 읽는다(memoryLocalCache라 구독을 닫으면 캐시도 비워진다). 그래서 매장 하나에 실시간
 * 구독 하나만 두고 화면들이 나눠 읽는다. framework 의존성이 없어 vitest에서 그대로 검증한다.
 *
 * 규칙:
 * - 데이터는 storeId별로만 보관하고 읽는다. 다른 매장 데이터가 새 매장 화면에 섞이지 않는다.
 * - 마지막 구독자가 떠나면 releaseDelayMs 뒤 구독을 닫고 데이터를 버린다. 화면 전환에서 이전 화면
 *   정리와 새 화면 구독 사이 틈, 짧은 왕복 이동은 같은 구독으로 받는다.
 * - 오류로 끝난 구독은 다음 구독자가 오거나 retry하면 다시 연다.
 * - 오류·stale 판정은 `useStoreProducts.recovery.ts` 계약과 같다.
 */

export interface StoreProductsSnapshot {
  products: Product[];
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
}

export type ListenStoreProducts = (
  storeId: string,
  onNext: (products: Product[]) => void,
  onError: (message: string) => void,
) => () => void;

export interface StoreProductsHubDeps {
  listen: ListenStoreProducts;
  releaseDelayMs: number;
}

export interface StoreProductsHub {
  getSnapshot: (storeId: string) => StoreProductsSnapshot;
  /** live=true면 실시간 구독을 함께 붙잡는다. false면(Firebase 로그인 전) 보관된 데이터만 지켜본다. */
  subscribe: (storeId: string, onChange: () => void, live: boolean) => () => void;
  retry: (storeId: string) => void;
}

export const INITIAL_STORE_PRODUCTS_SNAPSHOT: StoreProductsSnapshot = Object.freeze({
  products: [],
  loading: true,
  error: null,
  hasLoaded: false,
}) as StoreProductsSnapshot;

interface Entry {
  snapshot: StoreProductsSnapshot;
  observers: Set<() => void>;
  holders: number;
  stop: (() => void) | null;
  /** 구독을 열 때마다 올려 이전 구독의 늦은 콜백을 버린다. */
  generation: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

export function createStoreProductsHub({
  listen,
  releaseDelayMs,
}: StoreProductsHubDeps): StoreProductsHub {
  const entries = new Map<string, Entry>();

  function publish(entry: Entry, snapshot: StoreProductsSnapshot) {
    entry.snapshot = snapshot;
    for (const observer of entry.observers) observer();
  }

  function close(entry: Entry) {
    entry.generation += 1;
    const stop = entry.stop;
    entry.stop = null;
    stop?.();
  }

  function dropIfIdle(storeId: string, entry: Entry) {
    if (entry.holders > 0 || entry.observers.size > 0 || entry.releaseTimer) return;
    close(entry);
    if (entries.get(storeId) === entry) entries.delete(storeId);
  }

  function open(storeId: string, entry: Entry) {
    close(entry);
    const generation = entry.generation;
    const previous = entry.snapshot;
    // 이전 정상 데이터가 있으면 다시 열어도 initial loading으로 되돌리지 않고, 이전 오류를 성공
    // snapshot까지 유지해 fresh처럼 보이지 않게 한다.
    publish(
      entry,
      isStoreProductsBackgroundRefresh(previous.hasLoaded)
        ? { ...previous, loading: false }
        : { products: [], loading: true, error: null, hasLoaded: false },
    );
    const isCurrent = () => entries.get(storeId) === entry && entry.generation === generation;
    const stop = listen(
      storeId,
      (products) => {
        if (!isCurrent()) return;
        publish(entry, { products, loading: false, error: null, hasLoaded: true });
      },
      (message) => {
        if (!isCurrent()) return;
        // 오류로 끝난 구독은 닫아 두고 다음 구독자·retry 때 다시 연다.
        close(entry);
        // 첫 조회 실패는 []를 성공 empty로 승격하지 않고, 이전 정상 데이터가 있으면 지우지 않는다.
        publish(
          entry,
          entry.snapshot.hasLoaded
            ? { ...entry.snapshot, loading: false, error: message }
            : { products: [], loading: false, error: message, hasLoaded: false },
        );
      },
    );
    // listen 도중 오류로 이미 닫혔으면 받은 해제 함수를 바로 부른다.
    if (isCurrent()) entry.stop = stop;
    else stop();
  }

  function release(storeId: string, entry: Entry) {
    entry.holders -= 1;
    if (entry.holders > 0) return;
    entry.releaseTimer = setTimeout(() => {
      entry.releaseTimer = null;
      if (entry.holders > 0) return;
      close(entry);
      if (entry.observers.size === 0 && entries.get(storeId) === entry) entries.delete(storeId);
    }, releaseDelayMs);
  }

  return {
    getSnapshot(storeId) {
      return entries.get(storeId)?.snapshot ?? INITIAL_STORE_PRODUCTS_SNAPSHOT;
    },

    subscribe(storeId, onChange, live) {
      let entry = entries.get(storeId);
      if (!entry) {
        entry = {
          snapshot: INITIAL_STORE_PRODUCTS_SNAPSHOT,
          observers: new Set(),
          holders: 0,
          stop: null,
          generation: 0,
          releaseTimer: null,
        };
        entries.set(storeId, entry);
      }
      const current = entry;
      current.observers.add(onChange);
      if (live) {
        current.holders += 1;
        if (current.releaseTimer) {
          clearTimeout(current.releaseTimer);
          current.releaseTimer = null;
        }
        if (!current.stop) open(storeId, current);
      }

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        current.observers.delete(onChange);
        if (live) release(storeId, current);
        else dropIfIdle(storeId, current);
      };
    },

    retry(storeId) {
      const entry = entries.get(storeId);
      // Firebase 로그인 전처럼 붙잡은 구독자가 없으면 로그인 뒤 첫 구독이 연다.
      if (!entry || entry.holders === 0) return;
      open(storeId, entry);
    },
  };
}
