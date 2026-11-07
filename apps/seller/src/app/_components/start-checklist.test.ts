import { describe, expect, it } from 'vitest';
import {
  buildStartChecklist,
  readPayoutAccountForChecklist,
  readSaleRoundsForChecklist,
  readStoreProductsForChecklist,
  type StartChecklistRead,
} from './start-checklist';

const DONE: StartChecklistRead = { status: 'ready', done: true };
const TODO: StartChecklistRead = { status: 'ready', done: false };
const LOADING: StartChecklistRead = { status: 'loading' };
const ERROR: StartChecklistRead = { status: 'error' };

const statuses = (checklist: ReturnType<typeof buildStartChecklist>) =>
  checklist.items.map((item) => [item.key, item.status, item.href]);

describe('시작 체크리스트 판정', () => {
  it('새 가게(상품·회차·계좌 모두 없음)는 세 항목 모두 미완료로 보이고 바로가기를 단다', () => {
    const checklist = buildStartChecklist({ products: TODO, rounds: TODO, payout: TODO });
    expect(checklist.visible).toBe(true);
    expect(checklist.allDone).toBe(false);
    expect(statuses(checklist)).toEqual([
      ['products', 'todo', '/products/new'],
      ['rounds', 'todo', '/sale-rounds/new'],
      ['payout', 'todo', '/settings/payout-account'],
    ]);
  });

  it('셋 다 완료면 보이지 않는다', () => {
    const checklist = buildStartChecklist({ products: DONE, rounds: DONE, payout: DONE });
    expect(checklist.visible).toBe(false);
    expect(checklist.allDone).toBe(true);
  });

  it('하나만 남아도 보이고, 완료 항목은 완료로 보인다', () => {
    const checklist = buildStartChecklist({ products: DONE, rounds: DONE, payout: TODO });
    expect(checklist.visible).toBe(true);
    expect(checklist.allDone).toBe(false);
    expect(checklist.items.map((item) => item.status)).toEqual(['done', 'done', 'todo']);
  });

  it('조회 실패는 미완료로 단정하지 않고 확인하지 못함으로 보인다', () => {
    const checklist = buildStartChecklist({ products: DONE, rounds: DONE, payout: ERROR });
    expect(checklist.visible).toBe(true);
    expect(checklist.allDone).toBe(false);
    expect(checklist.items.map((item) => item.status)).toEqual(['done', 'done', 'unknown']);
  });

  it('미완료가 있으면 남은 조회 중 항목은 확인 중으로 보인다', () => {
    const checklist = buildStartChecklist({ products: TODO, rounds: LOADING, payout: LOADING });
    expect(checklist.visible).toBe(true);
    expect(checklist.items.map((item) => item.status)).toEqual(['todo', 'checking', 'checking']);
  });

  it('조회 중 항목만 남았으면 아직 보이지 않지만 완료로 보지도 않는다', () => {
    const allLoading = buildStartChecklist({ products: LOADING, rounds: LOADING, payout: LOADING });
    expect(allLoading.visible).toBe(false);
    expect(allLoading.allDone).toBe(false);
    const oneLoading = buildStartChecklist({ products: DONE, rounds: DONE, payout: LOADING });
    expect(oneLoading.visible).toBe(false);
    expect(oneLoading.allDone).toBe(false);
  });
});

describe('상품 조회 상태 → 체크리스트', () => {
  const base = { hasLoaded: true, loading: false, error: null, productCount: 0 };

  it('성공 0건이면 미완료, 1건 이상이면 완료', () => {
    expect(readStoreProductsForChecklist(base)).toEqual(TODO);
    expect(readStoreProductsForChecklist({ ...base, productCount: 1 })).toEqual(DONE);
  });

  it('첫 성공 전이거나 다시 읽는 중이면 확인 중', () => {
    expect(readStoreProductsForChecklist({ ...base, hasLoaded: false })).toEqual(LOADING);
    expect(readStoreProductsForChecklist({ ...base, hasLoaded: false, loading: true })).toEqual(
      LOADING,
    );
    expect(readStoreProductsForChecklist({ ...base, loading: true, productCount: 3 })).toEqual(
      LOADING,
    );
  });

  it('조회 실패(첫 실패·이전 데이터 위 실패 모두)는 확인하지 못함', () => {
    expect(readStoreProductsForChecklist({ ...base, hasLoaded: false, error: 'x' })).toEqual(ERROR);
    expect(readStoreProductsForChecklist({ ...base, error: 'x', productCount: 2 })).toEqual(ERROR);
  });
});

describe('회차 조회 상태 → 체크리스트', () => {
  it('성공 0개면 미완료, 1개 이상이면 완료', () => {
    expect(readSaleRoundsForChecklist({ loading: false, error: null, roundCount: 0 })).toEqual(
      TODO,
    );
    expect(readSaleRoundsForChecklist({ loading: false, error: null, roundCount: 1 })).toEqual(
      DONE,
    );
  });

  it('조회 중이면 확인 중, 실패면 확인하지 못함(빈 목록이어도 미완료로 보지 않는다)', () => {
    expect(readSaleRoundsForChecklist({ loading: true, error: null, roundCount: 0 })).toEqual(
      LOADING,
    );
    expect(readSaleRoundsForChecklist({ loading: false, error: 'x', roundCount: 0 })).toEqual(
      ERROR,
    );
  });
});

describe('정산 계좌 조회 상태 → 체크리스트', () => {
  it('등록·미등록·조회 중·실패를 구분한다', () => {
    expect(readPayoutAccountForChecklist('registered')).toEqual(DONE);
    expect(readPayoutAccountForChecklist('missing')).toEqual(TODO);
    expect(readPayoutAccountForChecklist('loading')).toEqual(LOADING);
    expect(readPayoutAccountForChecklist('error')).toEqual(ERROR);
  });
});
