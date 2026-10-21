import { describe, expect, it } from 'vitest';
import type { AdminStore } from '@/hooks/useAdmin';
import {
  describeArchiveConfirm,
  filterStores,
  formatStoreContact,
  getAdminStoresReadState,
  parseRate,
} from './_lib';

describe('parseRate', () => {
  it('소수 수수료율을 정상 값으로 변환한다', () => {
    expect(parseRate('0.05')).toEqual({ ok: true, rate: 0.05 });
  });

  it('하한 0을 허용한다', () => {
    expect(parseRate('0')).toEqual({ ok: true, rate: 0 });
  });

  it('상한 1을 허용한다', () => {
    expect(parseRate('1')).toEqual({ ok: true, rate: 1 });
  });

  it('빈 입력은 EMPTY 오류로 반환한다', () => {
    expect(parseRate('')).toEqual({ ok: false, errorCode: 'EMPTY' });
  });

  it('공백만 있는 입력은 EMPTY 오류로 반환한다', () => {
    expect(parseRate('  ')).toEqual({ ok: false, errorCode: 'EMPTY' });
  });

  it('숫자로 해석되지 않는 입력은 NOT_NUMBER 오류로 반환한다', () => {
    expect(parseRate('abc')).toEqual({ ok: false, errorCode: 'NOT_NUMBER' });
  });

  it('하한보다 작은 값은 OUT_OF_RANGE 오류로 반환한다', () => {
    expect(parseRate('-0.1')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
  });

  it('상한보다 큰 값은 OUT_OF_RANGE 오류로 반환한다', () => {
    expect(parseRate('1.5')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
  });

  it('앞뒤 공백을 제거한 값으로 변환한다', () => {
    expect(parseRate(' 0.5 ')).toEqual({ ok: true, rate: 0.5 });
  });
});

const FETCH_ERROR_MESSAGE = '판매자 목록 조회 중 오류 발생';

function store(id: string) {
  return { id };
}

describe('getAdminStoresReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(
      getAdminStoresReadState({ loading: true, error: null, stores: [], visible: [] }),
    ).toBe('LOADING');
  });

  it('loading + error는 LOADING을 우선한다(재시도 중 error 잔존)', () => {
    expect(
      getAdminStoresReadState({
        loading: true,
        error: FETCH_ERROR_MESSAGE,
        stores: [],
        visible: [],
      }),
    ).toBe('LOADING');
  });

  it('initial read failure → FETCH_ERROR를 반환한다', () => {
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [],
        visible: [],
      }),
    ).toBe('FETCH_ERROR');
  });

  it('read failure ≠ unfiltered empty', () => {
    // 실패 + 0건은 FETCH_ERROR이며 실제 0건 copy로 collapse되지 않는다.
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [],
        visible: [],
      }),
    ).toBe('FETCH_ERROR');
    // 성공 + 0건만 실제 0건이다.
    expect(
      getAdminStoresReadState({ loading: false, error: null, stores: [], visible: [] }),
    ).toBe('EMPTY_UNFILTERED');
  });

  it('read failure ≠ filtered empty', () => {
    // 실패 + 필터 결과 0건(stale stores 유지)도 FETCH_ERROR이다.
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [store('s1')],
        visible: [],
      }),
    ).toBe('FETCH_ERROR');
    // 성공 + 동일 shape만 필터 결과 0건이다.
    expect(
      getAdminStoresReadState({
        loading: false,
        error: null,
        stores: [store('s1')],
        visible: [],
      }),
    ).toBe('EMPTY_FILTERED');
  });

  it('error는 stale 결과보다 우선한다(useAdminList 이전 결과 보존 기준)', () => {
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [store('s1')],
        visible: [store('s1')],
      }),
    ).toBe('FETCH_ERROR');
  });

  it('성공 + 결과는 HAS_RESULTS를 반환한다', () => {
    expect(
      getAdminStoresReadState({
        loading: false,
        error: null,
        stores: [store('s1')],
        visible: [store('s1')],
      }),
    ).toBe('HAS_RESULTS');
  });
});

describe('판매자 검색·연락처·치우기 안내', () => {
  const stores = [
    { id: 's-1', name: '난플렉스', status: 'active', ceoName: '김대표', phone: '010-1234-5678' },
    { id: 's-2', name: '하늘정원', status: 'invited' },
  ] as AdminStore[];
  const search = (keyword: string) =>
    filterStores(stores, { keyword, status: 'all' }).map((store) => store.id);

  it('상호·대표자 이름·전화번호(하이픈 없이도)로 찾는다', () => {
    expect(search('난플')).toEqual(['s-1']);
    expect(search('김대표')).toEqual(['s-1']);
    expect(search('010-1234')).toEqual(['s-1']);
    expect(search('01012345678')).toEqual(['s-1']);
    expect(search('하늘')).toEqual(['s-2']);
    expect(search('9999')).toEqual([]);
  });

  it('대표자·연락처 한 줄, 둘 다 없으면 자리표시자', () => {
    expect(formatStoreContact(stores[0])).toBe('김대표 · 010-1234-5678');
    expect(formatStoreContact(stores[1])).toBe('—');
  });

  it('치우기 확인창은 실제 동작(숨김·주문 차단·로그인 유지·기록 있으면 불가)을 알린다', () => {
    const message = describeArchiveConfirm({ name: '난플렉스' });
    expect(message).toContain('난플렉스 판매자를 치울까요?');
    expect(message).toContain('손님 화면에서 가게와 상품이 숨고 새 주문을 받지 않습니다');
    expect(message).toContain('계속 로그인할 수 있고');
    expect(message).toContain('기록이 하나라도 있는 판매자는 치울 수 없습니다');
    expect(message).not.toContain('보존됩니다');
  });
});
