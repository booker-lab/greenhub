import type { Order, OrderItemSnapshot } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import {
  describeSellerCancelRefund,
  displayBuyerName,
  displayBuyerPhone,
  displayRequestNote,
  resolveOrderItemLines,
  summarizeOrderProducts,
  toTelHref,
} from './_lib';

function item(productName: string, quantity: number, subtotalAmount?: number): OrderItemSnapshot {
  return { productName, quantity, subtotalAmount } as OrderItemSnapshot;
}

describe('resolveOrderItemLines', () => {
  it('회차 주문은 상품마다 "상품명 × 수량" 줄과 금액을 준다', () => {
    const lines = resolveOrderItemLines({
      roundId: 'round-1',
      orderItems: [item('빅립', 2, 60000), item('만천홍', 1, 25000)],
    });
    expect(
      lines?.map(({ productName, quantity, subtotalAmount }) => ({
        productName,
        quantity,
        subtotalAmount,
      })),
    ).toEqual([
      { productName: '빅립', quantity: 2, subtotalAmount: 60000 },
      { productName: '만천홍', quantity: 1, subtotalAmount: 25000 },
    ]);
  });

  it('상품이 하나뿐인 회차 주문도 줄로 보여 준다', () => {
    expect(resolveOrderItemLines({ roundId: 'round-1', orderItems: [item('빅립', 1)] })).toEqual([
      { key: 'item:0', productName: '빅립', quantity: 1, subtotalAmount: null },
    ]);
  });

  it('예전 단일 상품 주문(상세 API가 만든 한 줄)은 null → 기존 상품명·수량 줄을 쓴다', () => {
    expect(
      resolveOrderItemLines({ roundId: null, orderItems: [item('호접란', 2, 20000)] }),
    ).toBeNull();
    expect(resolveOrderItemLines({ orderItems: [] })).toBeNull();
    expect(resolveOrderItemLines({})).toBeNull();
  });

  it('이름이 빠진 상품 줄도 숨기지 않고 대체 문구로 보여 준다', () => {
    const lines = resolveOrderItemLines({
      roundId: 'round-1',
      orderItems: [item('빅립', 1), item('  ', 3)],
    });
    expect(lines?.map((line) => line.productName)).toEqual(['빅립', '(상품 정보 없음)']);
  });
});

describe('summarizeOrderProducts', () => {
  it('상품이 여러 개면 "첫 상품명 외 N종"', () => {
    expect(
      summarizeOrderProducts({
        productName: '빅립',
        orderItems: [item('빅립', 2), item('만천홍', 1), item('v3', 1)],
      }),
    ).toBe('빅립 외 2종');
  });

  it('상품이 하나거나 상품 줄이 없으면 상품명 그대로', () => {
    expect(summarizeOrderProducts({ productName: '빅립', orderItems: [item('빅립', 3)] })).toBe(
      '빅립',
    );
    expect(summarizeOrderProducts({ productName: '호접란' })).toBe('호접란');
    expect(summarizeOrderProducts({ orderItems: [item('만천홍', 1)] })).toBe('만천홍');
    expect(summarizeOrderProducts({})).toBeNull();
  });
});

describe('displayBuyerName', () => {
  it('이름이 있으면 앞뒤 공백을 지우고 보여준다', () => {
    expect(displayBuyerName({ buyerName: '  김그린 ' })).toBe('김그린');
  });

  it('이름이 없거나 공백뿐이면 대체 문구를 보여준다', () => {
    expect(displayBuyerName({})).toBe('이름 없음');
    expect(displayBuyerName({ buyerName: '   ' })).toBe('이름 없음');
  });
});

describe('displayRequestNote', () => {
  it('요청사항이 있으면 앞뒤 공백만 지우고 줄바꿈은 유지한다', () => {
    expect(displayRequestNote({ requestNote: ' 받는 분 김그린\n문구: 개업 축하 ' })).toBe(
      '받는 분 김그린\n문구: 개업 축하',
    );
  });

  it('없거나 비어 있으면 null', () => {
    expect(displayRequestNote({})).toBeNull();
    expect(displayRequestNote({ requestNote: null })).toBeNull();
    expect(displayRequestNote({ requestNote: '  ' })).toBeNull();
  });
});

describe('displayBuyerPhone', () => {
  it('상세 API의 deliveryPhone을 쓴다', () => {
    expect(displayBuyerPhone({ deliveryPhone: '010-1234-5678' })).toBe('010-1234-5678');
  });

  it('없거나 비어 있으면 null', () => {
    expect(displayBuyerPhone({})).toBeNull();
    expect(displayBuyerPhone({ deliveryPhone: null })).toBeNull();
    expect(displayBuyerPhone({ deliveryPhone: ' ' })).toBeNull();
  });
});

describe('toTelHref', () => {
  it('하이픈·공백을 지운 숫자만 남긴다', () => {
    expect(toTelHref('010-1234-5678')).toBe('tel:01012345678');
    expect(toTelHref(' 010 1234 5678 ')).toBe('tel:01012345678');
  });

  it('맨 앞 +는 유지한다', () => {
    expect(toTelHref('+82 10-1234-5678')).toBe('tel:+821012345678');
  });

  it('숫자가 없으면 링크를 만들지 않는다', () => {
    expect(toTelHref('없음')).toBeNull();
  });
});

describe('describeSellerCancelRefund', () => {
  it('결제 금액 전액 환불과 되돌릴 수 없음을 금액과 함께 알린다', () => {
    expect(describeSellerCancelRefund({ status: 'ACCEPTED', totalAmount: 85000 })).toBe(
      '결제 금액 ₩85,000 전액을 환불하고 되돌릴 수 없어요.',
    );
  });

  it('배송 보류 주문은 결제된 재배송비도 함께 환불한다고 알린다', () => {
    expect(describeSellerCancelRefund({ status: 'DELIVERY_HELD', totalAmount: 30000 })).toBe(
      '결제 금액 ₩30,000 전액과 결제된 재배송비를 모두 환불하고 되돌릴 수 없어요.',
    );
  });

  it('재배송비를 이미 결제하고 재배송 준비로 돌린 주문도 재배송비 환불을 알린다', () => {
    const redeliveryPayment = { paid: true } as Order['redeliveryPayment'];
    expect(
      describeSellerCancelRefund({ status: 'PREPARING', totalAmount: 30000, redeliveryPayment }),
    ).toBe('결제 금액 ₩30,000 전액과 결제된 재배송비를 모두 환불하고 되돌릴 수 없어요.');
  });

  it('상품 파손 보류 주문은 파손으로 전액 환불한다고 알린다', () => {
    const deliveryHold = { reasonCode: 'PRODUCT_DAMAGED' } as Order['deliveryHold'];
    expect(
      describeSellerCancelRefund({ status: 'DELIVERY_HELD', totalAmount: 30000, deliveryHold }),
    ).toBe(
      '상품 파손으로 결제 금액 ₩30,000 전액을 환불해요. 결제된 재배송비가 있으면 함께 환불하고, 되돌릴 수 없어요.',
    );
  });
});
