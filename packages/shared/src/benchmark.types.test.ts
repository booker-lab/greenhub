import { describe, expect, it } from 'vitest';
import {
  PRODUCT_NOTICE_DEFAULT_CERTIFICATION,
  PRODUCT_NOTICE_DEFAULT_ORIGIN,
  PRODUCT_NOTICE_FIELDS,
  optionStockRemaining,
  resolveProductNotice,
} from './benchmark.types.js';

const fallback = { itemName: '호접란 빅립', producer: '디어 오키드', csPhone: '010-0000-0000' };

describe('상품정보제공고시 공통 계약', () => {
  it('기타 재화 고시 항목 다섯 개를 정해진 순서로 둔다', () => {
    expect(PRODUCT_NOTICE_FIELDS.map((field) => field.label)).toEqual([
      '품명',
      '원산지',
      '생산자',
      '인증·허가 사항',
      '소비자 상담 전화',
    ]);
  });

  it('값이 없으면 상품·매장·사업자 정보와 고정 기본값으로 채운다', () => {
    expect(resolveProductNotice(undefined, fallback)).toEqual({
      itemName: '호접란 빅립',
      origin: PRODUCT_NOTICE_DEFAULT_ORIGIN,
      producer: '디어 오키드',
      certification: PRODUCT_NOTICE_DEFAULT_CERTIFICATION,
      csPhone: '010-0000-0000',
    });
    expect(PRODUCT_NOTICE_DEFAULT_ORIGIN).toBe('국내산(경기도 이천)');
  });

  it('판매자가 쓴 값은 앞뒤 공백만 걷고 그대로 쓰며, 공백뿐인 칸은 기본값으로 본다', () => {
    const resolved = resolveProductNotice({ origin: ' 국내산(경기도 여주) ', producer: '   ' }, fallback);
    expect(resolved.origin).toBe('국내산(경기도 여주)');
    expect(resolved.producer).toBe('디어 오키드');
  });
});

describe('옵션 재고 남은 수량', () => {
  it('넣은 수량에서 결제 중·결제 완료 수량을 뺀다', () => {
    expect(optionStockRemaining({ stockQuantity: 10, reservedQuantity: 2, orderedQuantity: 3 })).toBe(5);
  });

  it('숫자가 아닌 값은 0으로 보고 음수는 0으로 둔다', () => {
    expect(optionStockRemaining({ stockQuantity: 4 })).toBe(4);
    expect(optionStockRemaining({ stockQuantity: '4', reservedQuantity: 1 })).toBe(0);
    expect(optionStockRemaining({ stockQuantity: 1, orderedQuantity: 3 })).toBe(0);
  });
});
