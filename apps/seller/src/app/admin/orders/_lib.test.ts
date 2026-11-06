import { describe, expect, it } from 'vitest';
import {
  buildStoreOptions,
  cancellationState,
  describeOrderAttention,
  describeRefundTarget,
  formatOrderedAt,
  getAdminOrdersReadState,
  getStatusTone,
  isPostDeliveryRefundable,
  isRefundable,
  normalizeRefundReason,
  ORDER_STATUS_TABS,
  orderRowActions,
  REFUND_REASON_MAX_LENGTH,
  STATUS_LABEL,
  storeLabel,
} from './_lib';

const FETCH_ERROR_MESSAGE = '주문 목록 조회 중 오류 발생';

function order(id: string) {
  return { id };
}

describe('getAdminOrdersReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(getAdminOrdersReadState({ loading: true, error: null, orders: [] })).toBe('LOADING');
  });

  it('조회 실패 + 0건은 FETCH_ERROR를 반환한다(EMPTY collapse 방지)', () => {
    expect(
      getAdminOrdersReadState({ loading: false, error: FETCH_ERROR_MESSAGE, orders: [] }),
    ).toBe('FETCH_ERROR');
  });

  it('성공 + 0건만 EMPTY를 반환한다', () => {
    expect(getAdminOrdersReadState({ loading: false, error: null, orders: [] })).toBe('EMPTY');
  });

  it('성공 + 1건 이상은 HAS_RESULTS를 반환한다', () => {
    expect(getAdminOrdersReadState({ loading: false, error: null, orders: [order('o1')] })).toBe(
      'HAS_RESULTS',
    );
  });

  it('loading + error는 LOADING을 우선한다', () => {
    expect(getAdminOrdersReadState({ loading: true, error: FETCH_ERROR_MESSAGE, orders: [] })).toBe(
      'LOADING',
    );
  });

  it('error는 결과 유무보다 우선한다', () => {
    expect(
      getAdminOrdersReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        orders: [order('o1')],
      }),
    ).toBe('FETCH_ERROR');
  });
});

describe('isRefundable — 서버 강제환불 허용 상태와 일치', () => {
  const round = (status: string) => ({ status, schemaVersion: 2, roundId: 'round-1' });
  const legacy = (status: string) => ({ status });

  it('회차 주문은 결제대기·배송 보류까지 허용한다', () => {
    const allowed = [
      'PENDING',
      'ACCEPTED',
      'RECRUITING',
      'CONFIRMED',
      'PREPARING',
      'DELIVERY_HELD',
    ];
    for (const status of allowed) {
      expect(isRefundable(round(status))).toBe(true);
    }
  });

  it('회차 주문도 배달 시작 이후와 취소 주문은 막는다', () => {
    const blocked = [
      'DELIVERING',
      'HUB_ARRIVED',
      'PICKED_UP',
      'DELIVERED',
      'REVIEWED',
      'CANCELLED',
    ];
    for (const status of blocked) {
      expect(isRefundable(round(status))).toBe(false);
    }
  });

  it('일반 주문은 접수·확정·준비중만 허용한다(모집중은 서버가 거부)', () => {
    for (const status of ['ACCEPTED', 'CONFIRMED', 'PREPARING']) {
      expect(isRefundable(legacy(status))).toBe(true);
    }
    for (const status of ['PENDING', 'RECRUITING', 'DELIVERY_HELD', 'DELIVERING', 'CANCELLED']) {
      expect(isRefundable(legacy(status))).toBe(false);
    }
  });

  it('roundId가 없거나 schemaVersion이 2가 아니면 일반 주문으로 본다', () => {
    expect(isRefundable({ status: 'PENDING', schemaVersion: 2, roundId: null })).toBe(false);
    expect(isRefundable({ status: 'PENDING', schemaVersion: 1, roundId: 'round-1' })).toBe(false);
  });
});

describe('주문 상태 라벨·점 색·탭', () => {
  it('배송 보류는 문제(빨강), 취소·결제 대기는 끝남(회색), 나머지는 검정이다', () => {
    expect(STATUS_LABEL.DELIVERY_HELD).toBe('배송 보류');
    expect(getStatusTone('DELIVERY_HELD')).toBe('problem');
    expect(getStatusTone('CANCELLED')).toBe('done');
    expect(getStatusTone('PENDING')).toBe('done');
    expect(getStatusTone('ACCEPTED')).toBe('default');
  });

  it('상태 탭은 전체 + 서버가 거를 수 있는 단일 상태다(배송 보류를 둘째에 둔다)', () => {
    expect(ORDER_STATUS_TABS.map((tab) => tab.key)).toEqual([
      '',
      'DELIVERY_HELD',
      'PENDING',
      'PREPARING',
      'DELIVERING',
      'DELIVERED',
      'CANCELLED',
    ]);
    for (const tab of ORDER_STATUS_TABS.slice(1)) {
      expect(tab.label).toBe(STATUS_LABEL[tab.key as keyof typeof STATUS_LABEL]);
    }
  });
});

describe('행 동작 — 처리가 필요한 행만 글자 버튼, 나머지는 ⋮', () => {
  const round = { schemaVersion: 2, roundId: 'round-1' };
  it('환불할 수 있는 배송 보류만 "환불" 글자 버튼이다', () => {
    expect(orderRowActions({ ...round, status: 'DELIVERY_HELD' })).toEqual({
      primary: 'refund',
      menu: [],
    });
  });

  it('결제 전 주문의 동작 이름은 "주문 취소…", 그 밖의 환불은 "환불…"이고 ⋮에 넣는다', () => {
    expect(orderRowActions({ ...round, status: 'PENDING' })).toEqual({
      primary: null,
      menu: [{ action: 'refund', label: '주문 취소…' }],
    });
    expect(orderRowActions({ ...round, status: 'ACCEPTED' }).menu).toEqual([
      { action: 'refund', label: '환불…' },
    ]);
  });

  it('배송 완료 회차 주문은 ⋮에 "배송 후 환불…"을 두고, 환불할 수 없으면 동작이 없다', () => {
    expect(orderRowActions({ ...round, status: 'DELIVERED' }).menu).toEqual([
      { action: 'post-delivery-refund', label: '배송 후 환불…' },
    ]);
    expect(orderRowActions({ ...round, status: 'DELIVERING' })).toEqual({
      primary: null,
      menu: [],
    });
  });
});

describe('확인할 일 줄', () => {
  it('배송 보류는 서버 건수, 환불 실패(취소 마무리 실패 포함)는 불러온 행에서 센다', () => {
    expect(
      describeOrderAttention({ count: 2, more: false }, [
        { cancellationStatus: 'REFUND_FAILED' },
        { cancellationStatus: 'LOCAL_FAILED' },
        { cancellationStatus: 'REFUNDING' },
        {},
      ]),
    ).toEqual({ held: 2, heldMore: false, refundFailed: 2, total: 4 });
  });

  it('배송 보류 건수를 아직 모르면 그 부분을 빼고, 쓸 것이 없으면 null', () => {
    expect(describeOrderAttention(undefined, [{ cancellationStatus: 'REFUND_FAILED' }])).toEqual({
      held: null,
      heldMore: false,
      refundFailed: 1,
      total: 1,
    });
    expect(describeOrderAttention({ count: 0, more: false }, [{}])).toBeNull();
    expect(describeOrderAttention(null, [])).toBeNull();
  });

  it('서버가 더 있다고 알리면 표시용 "더 있음"을 넘긴다', () => {
    expect(describeOrderAttention({ count: 100, more: true }, [])?.heldMore).toBe(true);
  });
});

describe('강제환불 확인창 대상 표시', () => {
  it('주문번호와 금액을 보여 준다', () => {
    expect(describeRefundTarget({ id: 'o1', orderNumber: 'ORD-1', totalAmount: 12000 })).toEqual({
      orderLabel: 'ORD-1',
      amountLabel: '₩12,000',
    });
  });

  it('주문번호가 없는 옛 주문은 줄이지 않은 전체 id를 보여 준다', () => {
    const id = 'legacy-order-id-0123456789';
    expect(describeRefundTarget({ id, totalAmount: 500 }).orderLabel).toBe(id);
  });

  it('빈 사유·공백 사유는 보내지 않고, 사유는 앞뒤 공백을 지운다', () => {
    expect(normalizeRefundReason('')).toBeUndefined();
    expect(normalizeRefundReason('   ')).toBeUndefined();
    expect(normalizeRefundReason(' 고객 요청 ')).toBe('고객 요청');
  });

  it('사유는 서버 한도(500자)를 넘겨 보내지 않는다', () => {
    expect(REFUND_REASON_MAX_LENGTH).toBe(500);
    expect(normalizeRefundReason('가'.repeat(600))).toHaveLength(500);
  });
});

describe('isPostDeliveryRefundable', () => {
  const round = { schemaVersion: 2, roundId: 'round-1' };
  it('배송 완료로 표시된 회차 주문만 배송 후 환불 버튼을 보여 준다', () => {
    expect(isPostDeliveryRefundable({ ...round, status: 'DELIVERED' })).toBe(true);
    expect(isPostDeliveryRefundable({ ...round, status: 'PICKED_UP' })).toBe(true);
    expect(isPostDeliveryRefundable({ ...round, status: 'REVIEWED' })).toBe(true);
    expect(isPostDeliveryRefundable({ ...round, status: 'PREPARING' })).toBe(false);
    expect(isPostDeliveryRefundable({ ...round, status: 'CANCELLED' })).toBe(false);
  });

  it('옛 일반 주문과 이미 배송 후 환불한 주문은 숨긴다', () => {
    expect(isPostDeliveryRefundable({ status: 'DELIVERED', schemaVersion: 1 })).toBe(false);
    expect(
      isPostDeliveryRefundable({
        ...round,
        status: 'DELIVERED',
        postDeliveryRefund: { memo: 'x' },
      }),
    ).toBe(false);
  });
});

describe('주문 목록 칸 표시', () => {
  it('주문일시는 KST로 보여 주고, 읽을 수 없으면 자리표시자', () => {
    expect(formatOrderedAt('2026-10-20T15:05:00.000Z')).toBe('2026-10-21 00:05');
    expect(formatOrderedAt({ _seconds: 0 })).toBe('1970-01-01 09:00');
    expect(formatOrderedAt(undefined)).toBe('—');
    expect(formatOrderedAt('not-a-date')).toBe('—');
  });

  it('환불 진행·실패만 상태를 더하고, 실패는 문제(빨강)다', () => {
    expect(cancellationState('REFUNDING')).toEqual({ label: '환불 진행 중', tone: 'default' });
    expect(cancellationState('REFUND_FAILED')).toEqual({ label: '환불 실패', tone: 'problem' });
    expect(cancellationState('COMPLETED')).toBeNull();
    expect(cancellationState(null)).toBeNull();
  });

  it('가게 이름이 없으면 잘린 id 대신 "이름 없는 가게"로 쓴다', () => {
    expect(storeLabel({ storeId: 'store-abcdef12', storeName: '난플렉스' })).toBe('난플렉스');
    expect(storeLabel({ storeId: 'store-abcdef12', storeName: null })).toBe('이름 없는 가게');
  });

  it('가게 선택은 전체 가게 + 이름순이고 치운 가게를 표시한다', () => {
    expect(
      buildStoreOptions([
        { id: 's-2', name: '하늘', status: 'archived' },
        { id: 's-1', name: '가람', status: 'active' },
      ]),
    ).toEqual([
      { value: '', label: '전체 가게' },
      { value: 's-1', label: '가람' },
      { value: 's-2', label: '하늘 (치움)' },
    ]);
  });
});
