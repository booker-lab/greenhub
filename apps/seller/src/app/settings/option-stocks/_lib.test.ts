import { describe, expect, it } from 'vitest';
import {
  describeStockCounts,
  readOptionStock,
  readOptionStocks,
  toAddBody,
  toCreateBody,
  toRemainingBody,
  upsertStock,
} from './_lib';

const POT = {
  id: 'stock-1',
  storeId: 'store-1',
  name: '흰색 출력 화분',
  stockQuantity: 10,
  reservedQuantity: 2,
  orderedQuantity: 3,
  remainingQuantity: 5,
};

describe('옵션 재고 화면 함수', () => {
  it('목록·단건 응답을 읽고 모양이 틀린 항목은 버린다', () => {
    expect(readOptionStocks({ stocks: [POT, { id: 'broken' }, null] })).toEqual([POT]);
    expect(readOptionStocks({})).toEqual([]);
    expect(readOptionStock({ stock: POT })).toEqual(POT);
    expect(readOptionStock({ stock: { ...POT, remainingQuantity: '5' } })).toBeNull();
  });

  it('새 품목은 이름과 지금 있는 개수(0 이상)를 받는다', () => {
    expect(toCreateBody({ name: ' 흰색 출력 화분 ', quantity: '12' })).toEqual({
      name: '흰색 출력 화분',
      quantity: 12,
    });
    expect(toCreateBody({ name: '화분', quantity: '0' })).toEqual({ name: '화분', quantity: 0 });
    expect(toCreateBody({ name: '  ', quantity: '1' })).toContain('재고 이름');
    expect(toCreateBody({ name: '화분', quantity: '' })).toContain('0~10000');
    expect(toCreateBody({ name: '화분', quantity: '1.5' })).toContain('0~10000');
    expect(toCreateBody({ name: '가'.repeat(31), quantity: '1' })).toContain('30자');
  });

  it('더하기는 1개 이상, 남은 개수 맞추기는 0개 이상만 받는다', () => {
    expect(toAddBody('5')).toEqual({ addQuantity: 5 });
    expect(toAddBody('0')).toContain('1~10000');
    expect(toAddBody('10001')).toContain('1~10000');
    expect(toRemainingBody('0')).toEqual({ remainingQuantity: 0 });
    expect(toRemainingBody('-1')).toContain('0~10000');
  });

  it('수량 설명은 0인 항목을 빼고 보여 준다', () => {
    expect(describeStockCounts(POT)).toBe('남은 5개 · 결제 중 2개 · 판매 3개');
    expect(describeStockCounts({ ...POT, reservedQuantity: 0, orderedQuantity: 0 })).toBe('남은 5개');
  });

  it('추가·수정한 품목을 이름 순 목록에 끼워 넣는다', () => {
    const a = { ...POT, id: 'a', name: '갈색 화분' };
    const b = { ...POT, id: 'b', name: '흰색 화분' };
    expect(upsertStock([b], a).map((stock) => stock.id)).toEqual(['a', 'b']);
    expect(upsertStock([a, b], { ...a, remainingQuantity: 9 })[0].remainingQuantity).toBe(9);
  });
});
