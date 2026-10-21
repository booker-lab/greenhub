import { describe, expect, it } from 'vitest';
import {
  buildStatusOptions,
  buildStoreOptions,
  cancellationBadge,
  describeRefundTarget,
  formatOrderedAt,
  getAdminOrdersReadState,
  getStatusColor,
  isRefundable,
  normalizeRefundReason,
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

describe('주문 상태 라벨·필터 옵션', () => {
  it('배송 보류(DELIVERY_HELD)를 라벨·빨강 색·필터 옵션에 포함한다', () => {
    expect(STATUS_LABEL.DELIVERY_HELD).toBe('배송 보류');
    expect(getStatusColor('DELIVERY_HELD')).toBe('red');
    expect(buildStatusOptions()).toContainEqual({ value: 'DELIVERY_HELD', label: '배송 보류' });
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

describe('주문 목록 칸 표시', () => {
  it('주문일시는 KST로 보여 주고, 읽을 수 없으면 자리표시자', () => {
    expect(formatOrderedAt('2026-10-20T15:05:00.000Z')).toBe('2026-10-21 00:05');
    expect(formatOrderedAt({ _seconds: 0 })).toBe('1970-01-01 09:00');
    expect(formatOrderedAt(undefined)).toBe('—');
    expect(formatOrderedAt('not-a-date')).toBe('—');
  });

  it('환불 진행·실패만 배지를 그린다', () => {
    expect(cancellationBadge('REFUNDING')).toEqual({ label: '환불 진행 중', color: 'yellow' });
    expect(cancellationBadge('REFUND_FAILED')).toEqual({ label: '환불 실패', color: 'red' });
    expect(cancellationBadge('COMPLETED')).toBeNull();
    expect(cancellationBadge(null)).toBeNull();
  });

  it('가게 이름이 없으면 id 앞자리로 대신한다', () => {
    expect(storeLabel({ storeId: 'store-abcdef12', storeName: '난플렉스' })).toBe('난플렉스');
    expect(storeLabel({ storeId: 'store-abcdef12', storeName: null })).toBe('store-ab…');
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
