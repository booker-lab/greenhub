import { describe, expect, it } from 'vitest';
import { COLOR_OPTIONS } from './product.types.js';

describe('ColorOption 공통 계약', () => {
  it('현재 색상 19개를 런타임 목록으로 제공한다', () => {
    expect(COLOR_OPTIONS).toHaveLength(19);
    expect(new Set(COLOR_OPTIONS).size).toBe(19);
  });
});
