import { describe, expect, it } from 'vitest';
import type { DriverCompletedOrder } from '../../../../lib/driver-completed-today';
import { buildCompletedRowView } from './completed-row';

const base: DriverCompletedOrder = {
  id: 'order-1',
  status: 'DELIVERED',
  deliveredAt: '2026-11-13T05:07:00.000Z',
  address: '경기도 이천시 증포동 새봄마을아파트 103동 1204호',
  deliveryAddress: {
    address: '경기도 이천시 증포동 새봄마을아파트',
    addressDetail: '103동 1204호',
  },
  productName: '동양란 빅립',
  quantity: 3,
  items: [
    { productName: '동양란 빅립', quantity: 1 },
    { productName: '서양란 호접', quantity: 2 },
  ],
  hasPhoto: true,
};

describe('오늘 완료 행 표시', () => {
  it('동·호수를 크게, 기본 주소를 작게, 서울 시각과 상품 요약을 쓴다', () => {
    expect(buildCompletedRowView(base)).toEqual({
      primary: '103동 1204호',
      secondary: '경기도 이천시 증포동 새봄마을아파트',
      time: '14:07',
      statusLabel: null,
      itemsText: '동양란 빅립 외 1종 · 총 3개',
    });
  });

  it('구매확정·환불됨 글자를 붙인다', () => {
    expect(buildCompletedRowView({ ...base, status: 'REVIEWED' }).statusLabel).toBe('구매확정');
    expect(buildCompletedRowView({ ...base, status: 'CANCELLED' }).statusLabel).toBe('환불됨');
  });

  it('기본 주소가 없거나 맞지 않으면 나누지 않고 전체 주소를 크게 쓴다', () => {
    const noBase = buildCompletedRowView({ ...base, deliveryAddress: undefined });
    expect(noBase.primary).toBe(base.address);
    expect(noBase.secondary).toBeNull();
    const mismatch = buildCompletedRowView({
      ...base,
      deliveryAddress: { address: '서울시 다른 주소' },
    });
    expect(mismatch.primary).toBe(base.address);
    expect(mismatch.secondary).toBeNull();
  });

  it('상품 목록이 없으면 첫 상품 이름과 총 수량으로 쓴다', () => {
    expect(buildCompletedRowView({ ...base, items: undefined }).itemsText).toBe(
      '동양란 빅립 · 총 3개',
    );
    expect(buildCompletedRowView({ ...base, items: undefined, quantity: 1 }).itemsText).toBe(
      '동양란 빅립',
    );
    expect(
      buildCompletedRowView({ ...base, items: [{ productName: '동양란 빅립', quantity: 2 }] })
        .itemsText,
    ).toBe('동양란 빅립 · 2개');
  });
});
