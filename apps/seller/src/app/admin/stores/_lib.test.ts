import { describe, expect, it } from 'vitest';
import type { AdminStore } from '@/hooks/useAdmin';
import {
  describeArchiveConfirm,
  describeArchiveRecordsConfirm,
  describeCommissionSaved,
  describeRestoreConfirm,
  describeSalesModeConfirm,
  describeSalesModeSaved,
  filterStores,
  formatRate,
  formatStoreContact,
  getAdminStoresReadState,
  nextSalesMode,
  parseRate,
  rateToInput,
  readStoreSalesMode,
  SALES_MODE_LABEL,
  salesModeActionLabel,
  storeIdConfirmPrefix,
} from './_lib';

describe('parseRate (% 단위 입력 → 0~1 저장값)', () => {
  it('% 숫자를 0~1 수수료율로 바꾼다(5 → 0.05)', () => {
    expect(parseRate('5')).toEqual({ ok: true, rate: 0.05 });
    expect(parseRate('7.5')).toEqual({ ok: true, rate: 0.075 });
    expect(parseRate('12.34')).toEqual({ ok: true, rate: 0.1234 });
  });

  it('하한 0%와 상한 100%를 허용한다', () => {
    expect(parseRate('0')).toEqual({ ok: true, rate: 0 });
    expect(parseRate('100')).toEqual({ ok: true, rate: 1 });
  });

  it('끝의 % 기호와 앞뒤 공백을 무시한다', () => {
    expect(parseRate(' 5% ')).toEqual({ ok: true, rate: 0.05 });
    expect(parseRate(' 3 ')).toEqual({ ok: true, rate: 0.03 });
  });

  it('소수 셋째 자리 이하는 둘째 자리로 반올림해 부동소수 오차를 남기지 않는다', () => {
    expect(parseRate('5.555')).toEqual({ ok: true, rate: 0.0556 });
    expect(parseRate('0.1')).toEqual({ ok: true, rate: 0.001 });
  });

  it('빈 입력·공백만 있는 입력은 EMPTY', () => {
    expect(parseRate('')).toEqual({ ok: false, errorCode: 'EMPTY' });
    expect(parseRate('  ')).toEqual({ ok: false, errorCode: 'EMPTY' });
    expect(parseRate('%')).toEqual({ ok: false, errorCode: 'EMPTY' });
  });

  it('숫자가 아니면 NOT_NUMBER(뒤에 글자가 붙은 값도 거절)', () => {
    expect(parseRate('abc')).toEqual({ ok: false, errorCode: 'NOT_NUMBER' });
    expect(parseRate('5abc')).toEqual({ ok: false, errorCode: 'NOT_NUMBER' });
  });

  it('0% 미만·100% 초과는 OUT_OF_RANGE', () => {
    expect(parseRate('-0.1')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
    expect(parseRate('100.5')).toEqual({ ok: false, errorCode: 'OUT_OF_RANGE' });
  });
});

describe('수수료율 표시', () => {
  it('저장값을 % 숫자로 보이고 미설정은 기본 5%로 보인다', () => {
    expect(formatRate(0.05)).toEqual({ percent: '5%', isDefault: false });
    expect(formatRate(0.075)).toEqual({ percent: '7.5%', isDefault: false });
    expect(formatRate(0)).toEqual({ percent: '0%', isDefault: false });
    expect(formatRate(undefined)).toEqual({ percent: '5%', isDefault: true });
  });

  it('편집칸 초기값은 % 숫자, 미설정이면 빈칸이다', () => {
    expect(rateToInput(0.05)).toBe('5');
    expect(rateToInput(0.1234)).toBe('12.34');
    expect(rateToInput(undefined)).toBe('');
  });

  it('입력 → 저장 → 다시 편집이 같은 값으로 돌아온다', () => {
    for (const input of ['0', '3', '5', '7.5', '12.34', '100']) {
      const parsed = parseRate(input);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(rateToInput(parsed.rate)).toBe(input);
    }
  });

  it('저장 안내는 다음 정산부터 적용·이미 만든 정산 불변을 알린다', () => {
    const message = describeCommissionSaved('난플렉스', 0.08);
    expect(message).toContain('난플렉스 수수료율 8%');
    expect(message).toContain('다음에 만들어지는 정산부터');
    expect(message).toContain('이미 만든 정산은 그대로');
  });
});

const FETCH_ERROR_MESSAGE = '판매자 목록 조회 중 오류 발생';

function store(id: string) {
  return { id };
}

describe('getAdminStoresReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(getAdminStoresReadState({ loading: true, error: null, stores: [], visible: [] })).toBe(
      'LOADING',
    );
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
    expect(getAdminStoresReadState({ loading: false, error: null, stores: [], visible: [] })).toBe(
      'EMPTY_UNFILTERED',
    );
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

describe('판매자 검색·연락처·정리하기 안내', () => {
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
    expect(formatStoreContact(stores[1])).toBe('대표·연락처 미등록');
  });

  it('정리하기 확인창은 실제 동작(숨김·주문 차단·로그인 유지·기록 있으면 ID 확인)을 알린다', () => {
    const view = describeArchiveConfirm({
      name: '난플렉스',
      ceoName: '김대표',
      phone: '010-1234-5678',
      status: 'active',
    });
    expect(view.title).toBe('난플렉스 판매자 정리하기');
    expect(view.lead).toContain('손님 화면에서 가게와 상품이 숨고 새 주문을 받지 않습니다');
    expect(view.lead).toContain('계속 로그인할 수 있고');
    expect(view.note).toContain(
      '기록이 있는 판매자는 가게 ID 앞 8자리를 한 번 더 입력해야 정리됩니다',
    );
    expect(view.facts).toEqual([
      { label: '상호', value: '난플렉스' },
      { label: '대표 · 연락처', value: '김대표 · 010-1234-5678' },
      { label: '상태', value: '운영 중' },
    ]);
    expect(view.confirmLabel).toBe('난플렉스 정리하기');
  });

  it('기록 있는 판매자 단계는 가게 ID 앞 8자리를 받는다(이름이 비어도 ID로 확인)', () => {
    const store = { id: '9b2cb652-ff77-46b9-a773-e1efa78fb763', name: '' };
    expect(storeIdConfirmPrefix(store.id)).toBe('9b2cb652');
    const view = describeArchiveRecordsConfirm(store);
    expect(view.prefix).toBe('9b2cb652');
    expect(view.lead).toContain('(미설정) 판매자는 주문·정산 기록이 있습니다.');
    expect(view.lead).toContain('기록은 그대로 남고');
    expect(view.facts).toContainEqual({ label: '가게 ID', value: store.id });
  });

  it('복구 확인창은 다시 보이고 주문을 받는다고 알린다', () => {
    const view = describeRestoreConfirm({ name: '난플렉스', status: 'archived' });
    expect(view.title).toBe('난플렉스 판매자 복구');
    expect(view.lead).toContain('손님 화면에 다시 보이고 새 주문을 받습니다');
    expect(view.confirmLabel).toBe('난플렉스 복구');
  });
});

describe('판매 방식 전환', () => {
  const base: AdminStore = {
    id: 's-1',
    name: '디어 오키드',
    status: 'active',
    ceoName: '홍길동',
    phone: '010-1234-5678',
    createdAt: null,
  };
  const withMode = (salesMode: unknown) => ({ ...base, salesMode }) as AdminStore;

  it('목록 응답의 salesMode를 읽고, 없거나 모르는 값은 예전 방식으로 본다', () => {
    expect(readStoreSalesMode(withMode('round_direct'))).toBe('round_direct');
    expect(readStoreSalesMode(withMode('legacy'))).toBe('legacy');
    expect(readStoreSalesMode(base)).toBe('legacy');
    expect(readStoreSalesMode(withMode(null))).toBe('legacy');
    expect(readStoreSalesMode(withMode('ROUND_DIRECT'))).toBe('legacy');
  });

  it('전환 대상은 지금과 반대 방식이고 동작 이름이 그에 맞다', () => {
    expect(nextSalesMode('legacy')).toBe('round_direct');
    expect(nextSalesMode('round_direct')).toBe('legacy');
    expect(salesModeActionLabel('round_direct')).toBe('회차 판매로 바꾸기');
    expect(salesModeActionLabel('legacy')).toBe('예전 방식으로 바꾸기');
    expect(SALES_MODE_LABEL).toEqual({ legacy: '예전 방식', round_direct: '회차 판매' });
  });

  it('예전 방식 가게 확인창은 회차가 손님에게 보인다고 알리고 막힘 안내는 없다', () => {
    const view = describeSalesModeConfirm(base);
    expect(view.target).toBe('round_direct');
    expect(view.title).toBe('디어 오키드 회차 판매로 바꾸기');
    expect(view.lead).toContain('회차 판매로 바꾸면 손님에게 회차가 보여요');
    expect(view.facts).toEqual([
      { label: '상호', value: '디어 오키드' },
      { label: '지금 판매 방식', value: '예전 방식' },
      { label: '바꿀 판매 방식', value: '회차 판매' },
    ]);
    expect(view.note).toBeUndefined();
    expect(view.confirmLabel).toBe('회차 판매로 바꾸기');
  });

  it('회차 판매 가게 확인창은 회차가 숨겨진다고 알리고 끝나지 않은 회차가 있으면 막힌다고 안내한다', () => {
    const view = describeSalesModeConfirm(withMode('round_direct'));
    expect(view.target).toBe('legacy');
    expect(view.title).toBe('디어 오키드 예전 방식으로 바꾸기');
    expect(view.lead).toContain('예전 방식으로 바꾸면 회차가 손님에게서 숨겨져요');
    expect(view.facts[1]).toEqual({ label: '지금 판매 방식', value: '회차 판매' });
    expect(view.facts[2]).toEqual({ label: '바꿀 판매 방식', value: '예전 방식' });
    expect(view.note).toContain('끝나지 않은 회차');
    expect(view.confirmLabel).toBe('예전 방식으로 바꾸기');
  });

  it('이름 없는 가게도 대상을 표시한다', () => {
    expect(describeSalesModeConfirm({ ...base, name: '  ' }).title).toBe(
      '(미설정) 회차 판매로 바꾸기',
    );
  });

  it('성공 안내는 바뀐 결과를 알린다', () => {
    expect(describeSalesModeSaved('디어 오키드', 'round_direct')).toBe(
      '디어 오키드 가게를 회차 판매로 바꿨어요. 손님에게 회차가 보여요.',
    );
    expect(describeSalesModeSaved('', 'legacy')).toBe(
      '(미설정) 가게를 예전 방식으로 바꿨어요. 회차는 손님에게서 숨겨져요.',
    );
  });
});
