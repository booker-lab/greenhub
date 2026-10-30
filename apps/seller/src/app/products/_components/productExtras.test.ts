import { describe, expect, it } from 'vitest';
import {
  defaultExtras,
  extrasBody,
  extrasFromProduct,
  fillNoticeDefaults,
  nextOptionId,
  noticeBody,
  optionStockSelectData,
} from './productExtras';

describe('productExtras', () => {
  it('기본 입력은 빈 목록과 꺼진 여부 값만 보낸다', () => {
    expect(extrasBody(defaultExtras())).toEqual({
      ok: true,
      body: { placements: [], options: [], guaranteed: false, aliases: [] },
    });
  });

  it('정상가 칸은 없고, 응답에 남은 정상가도 본문에 다시 싣지 않는다', () => {
    const form = extrasFromProduct({ listPrice: 39000 } as never);
    expect(form).not.toHaveProperty('listPrice');
    const result = extrasBody(form);
    expect(result.ok && result.body).not.toHaveProperty('listPrice');
  });

  it('크기·관리법·옵션·다른 이름을 API 계약으로 바꾼다', () => {
    const form = {
      ...defaultExtras(),
      heightCm: '60',
      light: 'medium' as const,
      careGuide: { watering: ' 겉흙이 마르면 ', light: '', temperature: '', repotting: '' },
      options: [
        {
          id: 'g1',
          name: '화분',
          choices: [
            { id: 'c1', label: '기본', priceDelta: '', stockId: '' },
            { id: 'c2', label: '3D 토퍼', priceDelta: '5000', stockId: '' },
            { id: 'c3', label: ' ', priceDelta: '', stockId: '' },
            { id: 'c4', label: '출력 화분', priceDelta: '7000', stockId: 'stock-pot' },
          ],
        },
      ],
      aliases: '몬스테라, Monstera deliciosa,',
    };
    const result = extrasBody(form);
    expect(result).toMatchObject({
      ok: true,
      body: {
        size: { heightCm: 60 },
        light: 'medium',
        careGuide: { watering: '겉흙이 마르면', light: '' },
        options: [
          {
            id: 'g1',
            name: '화분',
            choices: [
              { id: 'c1', label: '기본', priceDelta: 0 },
              { id: 'c2', label: '3D 토퍼', priceDelta: 5000 },
              { id: 'c4', label: '출력 화분', priceDelta: 7000, stockId: 'stock-pot' },
            ],
          },
        ],
        aliases: ['몬스테라', 'Monstera deliciosa'],
      },
    });
  });

  it('범위를 벗어난 숫자는 오류로 돌려준다', () => {
    expect(extrasBody({ ...defaultExtras(), heightCm: '0' }).ok).toBe(false);
    expect(extrasBody({ ...defaultExtras(), heightCm: '1.5' }).ok).toBe(false);
  });

  it('API 응답을 입력 상태로 되돌리고 모르는 값은 버린다', () => {
    const form = extrasFromProduct({
      placements: ['living', 'garden' as never],
      options: [
        {
          id: 'g1',
          name: '크기',
          choices: [
            // 2026-10-30 전 상품 문서에 남은 문구 입력 여부(needsText)는 읽지 않는다.
            { id: 'c1', label: '대', priceDelta: 3000, needsText: true } as never,
            { id: 'c2', label: '출력 화분', priceDelta: 0, stockId: 'stock-pot' },
          ],
        },
      ],
      aliases: ['a', 'b'],
    });
    expect(form.placements).toEqual(['living']);
    expect(form.options[0].choices[0].priceDelta).toBe('3000');
    expect(form.options[0].choices[0]).not.toHaveProperty('needsText');
    expect(form.options[0].choices[0].stockId).toBe('');
    expect(form.options[0].choices[1].stockId).toBe('stock-pot');
    expect(form.aliases).toBe('a, b');
  });

  it('고시 기본 입력은 원산지·인증 사항을 미리 채우고, 매장 정보로 생산자·상담 전화를 채운다', () => {
    const notice = fillNoticeDefaults(defaultExtras().notice, { producer: '디어 오키드', csPhone: '010-0000-0000' });
    expect(notice).toEqual({
      itemName: '',
      origin: '국내산(경기도 이천)',
      producer: '디어 오키드',
      certification: '해당 없음',
      csPhone: '010-0000-0000',
    });
  });

  it('판매자가 쓴 고시 값은 매장 기본값으로 덮지 않는다', () => {
    const form = extrasFromProduct({ notice: { producer: '이천 난농원', csPhone: '031-000-0000' } });
    const notice = fillNoticeDefaults(form.notice, { producer: '디어 오키드', csPhone: '010-0000-0000' });
    expect(notice.producer).toBe('이천 난농원');
    expect(notice.csPhone).toBe('031-000-0000');
    expect(notice.origin).toBe('국내산(경기도 이천)');
  });

  it('고시는 추가 정보 본문과 따로 만들고, 공백을 걷고 빈 칸은 뺀다', () => {
    const extras = extrasBody(defaultExtras());
    expect(extras.ok && extras.body).not.toHaveProperty('notice');
    expect(
      noticeBody({ itemName: '  ', origin: ' 국내산 ', producer: '디어 오키드', certification: '', csPhone: '' }),
    ).toEqual({ ok: true, body: { origin: '국내산', producer: '디어 오키드' } });
  });

  it('고시 항목이 너무 길면 오류로 돌려준다', () => {
    const result = noticeBody({ ...defaultExtras().notice, itemName: '가'.repeat(61) });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('품명');
  });

  it('새 옵션 id는 겹치지 않는다', () => {
    expect(nextOptionId('g', ['g1', 'g2'])).toBe('g3');
    expect(nextOptionId('c', [])).toBe('c1');
  });

  it('재고 연결 목록은 연결 안 함을 먼저 두고, 목록에 없는 저장값은 지우지 않는다', () => {
    const stock = {
      id: 'stock-pot',
      storeId: 'store-1',
      name: '흰색 출력 화분',
      stockQuantity: 10,
      reservedQuantity: 1,
      orderedQuantity: 2,
      remainingQuantity: 7,
    };
    expect(optionStockSelectData([stock], '')).toEqual([
      { value: '', label: '연결 안 함 (수량 제한 없음)' },
      { value: 'stock-pot', label: '흰색 출력 화분 (남은 7개)' },
    ]);
    expect(optionStockSelectData([], 'stock-gone').at(-1)).toEqual({
      value: 'stock-gone',
      label: '연결된 재고 (목록에서 찾지 못함)',
    });
  });
});
