import type { Product } from '@greenhub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStoreProductsHub, INITIAL_STORE_PRODUCTS_SNAPSHOT } from './useStoreProducts.hub';

// Firestore onSnapshot 대신 매장별 구독 열기·닫기를 기록하는 가짜 listen.
type Listener = {
  storeId: string;
  next: (products: Product[]) => void;
  fail: (message: string) => void;
  stopped: boolean;
};

const RELEASE_DELAY_MS = 60_000;

function product(id: string, storeId: string): Product {
  return { id, storeId, createdAt: '2026-10-23T00:00:00.000Z' } as unknown as Product;
}

function setup() {
  const listeners: Listener[] = [];
  const hub = createStoreProductsHub({
    releaseDelayMs: RELEASE_DELAY_MS,
    listen: (storeId, next, fail) => {
      const listener: Listener = { storeId, next, fail, stopped: false };
      listeners.push(listener);
      return () => {
        listener.stopped = true;
      };
    },
  });
  const opened = (storeId: string) => listeners.filter((l) => l.storeId === storeId);
  const live = (storeId: string) => opened(storeId).filter((l) => !l.stopped);
  return { hub, listeners, opened, live };
}

describe('useStoreProducts 공유소 — 같은 매장은 구독 하나', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('홈·상품·준비 화면이 같은 매장을 구독하면 Firestore 구독은 1개이고 같은 데이터를 본다', () => {
    const { hub, opened } = setup();
    const home = vi.fn();
    const products = vi.fn();
    hub.subscribe('store-a', home, true);
    hub.subscribe('store-a', products, true);

    expect(opened('store-a')).toHaveLength(1);
    opened('store-a')[0].next([product('p1', 'store-a')]);

    expect(home).toHaveBeenCalled();
    expect(products).toHaveBeenCalled();
    expect(hub.getSnapshot('store-a')).toMatchObject({
      products: [{ id: 'p1' }],
      loading: false,
      error: null,
      hasLoaded: true,
    });
  });

  it('화면을 옮기며 이전 화면이 먼저 떠나도 해제 지연 안에 새 화면이 오면 다시 읽지 않는다', () => {
    const { hub, opened, live } = setup();
    const leaveHome = hub.subscribe('store-a', vi.fn(), true);
    opened('store-a')[0].next([product('p1', 'store-a')]);

    leaveHome();
    vi.advanceTimersByTime(RELEASE_DELAY_MS - 1);
    hub.subscribe('store-a', vi.fn(), true);
    vi.advanceTimersByTime(RELEASE_DELAY_MS * 2);

    expect(opened('store-a')).toHaveLength(1);
    expect(live('store-a')).toHaveLength(1);
    expect(hub.getSnapshot('store-a').products).toHaveLength(1);
  });

  it('마지막 구독자가 떠나면 해제 지연 뒤 구독을 닫고 데이터를 버린다', () => {
    const { hub, opened, live } = setup();
    const leaveA = hub.subscribe('store-a', vi.fn(), true);
    const leaveB = hub.subscribe('store-a', vi.fn(), true);
    opened('store-a')[0].next([product('p1', 'store-a')]);

    leaveA();
    vi.advanceTimersByTime(RELEASE_DELAY_MS);
    expect(live('store-a')).toHaveLength(1);

    leaveB();
    leaveB();
    vi.advanceTimersByTime(RELEASE_DELAY_MS);
    expect(live('store-a')).toHaveLength(0);
    expect(hub.getSnapshot('store-a')).toBe(INITIAL_STORE_PRODUCTS_SNAPSHOT);

    hub.subscribe('store-a', vi.fn(), true);
    expect(opened('store-a')).toHaveLength(2);
    expect(hub.getSnapshot('store-a').hasLoaded).toBe(false);
  });

  it('매장이 바뀌면 새 매장은 처음 로딩부터 시작하고 이전 매장 데이터가 섞이지 않는다', () => {
    const { hub, opened, live } = setup();
    const leaveA = hub.subscribe('store-a', vi.fn(), true);
    const listenerA = opened('store-a')[0];
    listenerA.next([product('a1', 'store-a')]);

    leaveA();
    hub.subscribe('store-b', vi.fn(), true);
    expect(hub.getSnapshot('store-b')).toEqual(INITIAL_STORE_PRODUCTS_SNAPSHOT);

    opened('store-b')[0].next([product('b1', 'store-b')]);
    listenerA.next([product('a2', 'store-a')]);
    expect(hub.getSnapshot('store-b').products.map((p) => p.id)).toEqual(['b1']);

    vi.advanceTimersByTime(RELEASE_DELAY_MS);
    expect(live('store-a')).toHaveLength(0);
    expect(live('store-b')).toHaveLength(1);
  });

  it('닫힌 구독에서 늦게 온 콜백은 다시 연 같은 매장 데이터를 덮지 않는다', () => {
    const { hub, opened } = setup();
    const leave = hub.subscribe('store-a', vi.fn(), true);
    const stale = opened('store-a')[0];
    leave();
    vi.advanceTimersByTime(RELEASE_DELAY_MS);

    hub.subscribe('store-a', vi.fn(), true);
    opened('store-a')[1].next([product('fresh', 'store-a')]);
    stale.next([product('old', 'store-a')]);
    stale.fail('늦은 오류');

    expect(hub.getSnapshot('store-a')).toMatchObject({
      products: [{ id: 'fresh' }],
      error: null,
    });
  });

  it('Firebase 로그인 전 구독자는 구독을 열지 않고, 로그인 뒤 구독자가 열면 같은 데이터를 본다', () => {
    const { hub, opened } = setup();
    const waiting = vi.fn();
    const leaveWaiting = hub.subscribe('store-a', waiting, false);
    expect(opened('store-a')).toHaveLength(0);
    expect(hub.getSnapshot('store-a')).toBe(INITIAL_STORE_PRODUCTS_SNAPSHOT);

    leaveWaiting();
    hub.subscribe('store-a', vi.fn(), true);
    expect(opened('store-a')).toHaveLength(1);
  });

  it('첫 조회 실패는 빈 목록으로 승격하지 않고, 다음 구독자가 오면 다시 연다', () => {
    const { hub, opened } = setup();
    hub.subscribe('store-a', vi.fn(), true);
    opened('store-a')[0].fail('권한 없음');

    expect(hub.getSnapshot('store-a')).toEqual({
      products: [],
      loading: false,
      error: '권한 없음',
      hasLoaded: false,
    });

    hub.subscribe('store-a', vi.fn(), true);
    expect(opened('store-a')).toHaveLength(2);
    expect(hub.getSnapshot('store-a')).toMatchObject({ loading: true, error: null });
  });

  it('정상 데이터 뒤 실패는 stale로 유지하고, retry는 loading으로 되돌리지 않은 채 다시 연다', () => {
    const { hub, opened, live } = setup();
    hub.subscribe('store-a', vi.fn(), true);
    opened('store-a')[0].next([product('p1', 'store-a')]);
    opened('store-a')[0].fail('네트워크 오류');

    expect(hub.getSnapshot('store-a')).toMatchObject({
      products: [{ id: 'p1' }],
      loading: false,
      error: '네트워크 오류',
      hasLoaded: true,
    });

    hub.retry('store-a');
    expect(opened('store-a')).toHaveLength(2);
    expect(live('store-a')).toHaveLength(1);
    expect(hub.getSnapshot('store-a')).toMatchObject({
      loading: false,
      error: '네트워크 오류',
      hasLoaded: true,
    });

    opened('store-a')[1].next([]);
    expect(hub.getSnapshot('store-a')).toMatchObject({
      products: [],
      error: null,
      hasLoaded: true,
    });
  });

  it('구독을 붙잡은 화면이 없으면 retry는 구독을 열지 않는다', () => {
    const { hub, opened } = setup();
    hub.subscribe('store-a', vi.fn(), false);
    hub.retry('store-a');
    hub.retry('store-b');
    expect(opened('store-a')).toHaveLength(0);
    expect(opened('store-b')).toHaveLength(0);
  });

  it('listen 도중 바로 실패해도 받은 해제 함수를 부르고 오류를 남긴다', () => {
    const stops: string[] = [];
    const hub = createStoreProductsHub({
      releaseDelayMs: RELEASE_DELAY_MS,
      listen: (storeId, _next, fail) => {
        fail('즉시 실패');
        return () => stops.push(storeId);
      },
    });
    hub.subscribe('store-a', vi.fn(), true);

    expect(stops).toEqual(['store-a']);
    expect(hub.getSnapshot('store-a')).toMatchObject({ error: '즉시 실패', hasLoaded: false });
  });
});
