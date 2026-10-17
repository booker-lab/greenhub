import { describe, expect, it } from 'vitest';
import { defaultExtras, extrasBody, extrasFromProduct, nextOptionId } from './productExtras';

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
            { id: 'c1', label: '기본', priceDelta: '', needsText: false },
            { id: 'c2', label: '3D 토퍼', priceDelta: '5000', needsText: true },
            { id: 'c3', label: ' ', priceDelta: '', needsText: false },
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
              { id: 'c2', label: '3D 토퍼', priceDelta: 5000, needsText: true },
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
      options: [{ id: 'g1', name: '크기', choices: [{ id: 'c1', label: '대', priceDelta: 3000, needsText: true }] }],
      aliases: ['a', 'b'],
    });
    expect(form.placements).toEqual(['living']);
    expect(form.options[0].choices[0].priceDelta).toBe('3000');
    expect(form.options[0].choices[0].needsText).toBe(true);
    expect(form.aliases).toBe('a, b');
  });

  it('새 옵션 id는 겹치지 않는다', () => {
    expect(nextOptionId('g', ['g1', 'g2'])).toBe('g3');
    expect(nextOptionId('c', [])).toBe('c1');
  });
});
