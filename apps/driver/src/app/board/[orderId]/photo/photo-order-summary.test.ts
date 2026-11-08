import { describe, expect, it } from 'vitest';
import {
  deliveryCompletedMessage,
  photoOrderSummaryLine,
  readPhotoOrderSummary,
} from './photo-order-summary';

const ORDER_ID = 'order-1';

describe('readPhotoOrderSummary', () => {
  it('기본 주소 뒤 동·호수를 나눠 동·호수와 받는 분을 읽는다', () => {
    expect(
      readPhotoOrderSummary(
        {
          id: ORDER_ID,
          address: '서울 강남구 테헤란로 1 101동 1203호',
          deliveryAddress: { address: '서울 강남구 테헤란로 1' },
          buyerName: ' 김그린 ',
        },
        ORDER_ID,
      ),
    ).toEqual({ place: '101동 1203호', recipient: '김그린' });
  });

  it('동·호수를 나눌 수 없으면 전체 주소를 쓴다', () => {
    expect(
      readPhotoOrderSummary({ id: ORDER_ID, address: '서울 강남구 테헤란로 1' }, ORDER_ID),
    ).toEqual({ place: '서울 강남구 테헤란로 1', recipient: null });
    expect(
      readPhotoOrderSummary(
        {
          id: ORDER_ID,
          address: '서울 강남구 테헤란로 1',
          deliveryAddress: { address: '부산 해운대구 다른길 2' },
          buyerName: '',
        },
        ORDER_ID,
      ),
    ).toEqual({ place: '서울 강남구 테헤란로 1', recipient: null });
  });

  it('다른 주문의 응답이거나 주소가 없거나 형식이 맞지 않으면 null이다', () => {
    const address = '서울 강남구 테헤란로 1 101동 1203호';
    expect(readPhotoOrderSummary({ id: 'order-OTHER', address }, ORDER_ID)).toBeNull();
    expect(readPhotoOrderSummary({ address }, ORDER_ID)).toBeNull();
    expect(readPhotoOrderSummary({ id: ORDER_ID }, ORDER_ID)).toBeNull();
    expect(readPhotoOrderSummary({ id: ORDER_ID, address: '   ' }, ORDER_ID)).toBeNull();
    expect(readPhotoOrderSummary({ id: ORDER_ID, address: 123 }, ORDER_ID)).toBeNull();
    expect(readPhotoOrderSummary(null, ORDER_ID)).toBeNull();
    expect(readPhotoOrderSummary('order-1', ORDER_ID)).toBeNull();
  });

  it('형식이 어긋난 기본 주소·받는 분은 무시한다', () => {
    expect(
      readPhotoOrderSummary(
        { id: ORDER_ID, address: '서울 101동', deliveryAddress: 'x', buyerName: 7 },
        ORDER_ID,
      ),
    ).toEqual({ place: '서울 101동', recipient: null });
  });
});

describe('photoOrderSummaryLine', () => {
  it('받는 분이 있으면 함께, 없으면 주소만 쓴다', () => {
    expect(photoOrderSummaryLine({ place: '101동 1203호', recipient: '김그린' })).toBe(
      '101동 1203호 · 받는 분 김그린',
    );
    expect(photoOrderSummaryLine({ place: '101동 1203호', recipient: null })).toBe('101동 1203호');
  });
});

describe('deliveryCompletedMessage', () => {
  it('주소를 알면 동·호수를 넣고, 모르면 주소 없이 쓴다', () => {
    expect(deliveryCompletedMessage({ place: '101동 1203호', recipient: '김그린' })).toBe(
      '101동 1203호 배송을 완료했어요.',
    );
    expect(deliveryCompletedMessage(null)).toBe('배송을 완료했어요.');
  });
});
