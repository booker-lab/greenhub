import { describe, expect, it } from 'vitest';
import { getGroupBuyStatus } from './groupbuy.js';

const now = new Date('2026-06-17T00:00:00.000Z');
const future = '2026-06-18T00:00:00.000Z';
const past = '2026-06-16T00:00:00.000Z';

describe('getGroupBuyStatus', () => {
  it('공구 설정이 없으면 정보 확인 필요로 본다', () => {
    expect(getGroupBuyStatus(null, now).status).toBe('missing_config');
  });

  it('마감 전 목표수량 미달이면 모집 중으로 본다', () => {
    const result = getGroupBuyStatus(
      { currentQuantity: 3, minQuantity: 5, targetQuantity: 10, recruitDeadline: future },
      now,
    );

    expect(result.status).toBe('recruiting');
    expect(result.canParticipate).toBe(true);
    expect(result.remainingToTarget).toBe(7);
  });

  it('마감 전 목표수량 이상이면 모집 완료로 본다', () => {
    expect(
      getGroupBuyStatus(
        { currentQuantity: 10, minQuantity: 5, targetQuantity: 10, recruitDeadline: future },
        now,
      ).status,
    ).toBe('target_reached');
  });

  it('마감 후 최소수량 이상이면 모집 종료로 본다', () => {
    expect(
      getGroupBuyStatus(
        { currentQuantity: 6, minQuantity: 5, targetQuantity: 10, recruitDeadline: past },
        now,
      ).status,
    ).toBe('deadline_closed');
  });

  it('마감 후 최소수량 미달이면 모집 실패로 본다', () => {
    expect(
      getGroupBuyStatus(
        { currentQuantity: 4, minQuantity: 5, targetQuantity: 10, recruitDeadline: past },
        now,
      ).status,
    ).toBe('failed_minimum');
  });

  it('목표수량이나 마감일이 유효하지 않으면 정보 확인 필요로 본다', () => {
    expect(
      getGroupBuyStatus(
        { currentQuantity: 1, minQuantity: 1, targetQuantity: 0, recruitDeadline: future },
        now,
      ).status,
    ).toBe('invalid_config');
    expect(
      getGroupBuyStatus(
        { currentQuantity: 1, minQuantity: 1, targetQuantity: 2, recruitDeadline: 'not-a-date' },
        now,
      ).status,
    ).toBe('invalid_config');
  });
});
