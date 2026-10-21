import { describe, expect, it } from 'vitest';
import { actionLabel, describeChanges, formatLoggedAt, targetLabel } from './_lib';

describe('actionLabel', () => {
  it('아는 기록 종류는 한국어 이름을 보여 준다', () => {
    expect(actionLabel('admin.settlement.paid')).toBe('정산 지급');
    expect(actionLabel('admin.order.force_refunded')).toBe('강제 환불');
    expect(actionLabel('admin.order.post_delivery_refunded')).toBe('배송 후 환불');
    expect(actionLabel('admin.partner_inquiry.deleted')).toBe('입점 문의 삭제');
  });

  it('모르는 기록 종류는 원래 값을 그대로 보여 준다', () => {
    expect(actionLabel('admin.future.action')).toBe('admin.future.action');
  });
});

describe('targetLabel', () => {
  it('12자를 넘는 ID만 앞 8자로 줄인다', () => {
    expect(targetLabel({ targetType: 'order', targetId: '1234567890abcdef' })).toBe(
      '주문 12345678…',
    );
    expect(targetLabel({ targetType: 'banner', targetId: 'main_hero' })).toBe('배너 main_hero');
    expect(targetLabel({ targetType: 'store', targetId: 'abc' })).toBe('판매자 abc');
  });
});

describe('describeChanges', () => {
  it('수수료는 퍼센트로, 참·거짓은 예·아니오로 보여 준다', () => {
    expect(
      describeChanges({ before: { commissionRate: 0.1 }, after: { commissionRate: 0.155 } }),
    ).toEqual(['commissionRate: 10% → 15.5%']);
    expect(describeChanges({ before: { suspended: false }, after: { suspended: true } })).toEqual([
      'suspended: 아니오 → 예',
    ]);
  });

  it('이전 값이 없으면 없음으로, 같은 값인 칸은 빼고 보여 준다', () => {
    expect(
      describeChanges({ before: null, after: { headline: '새 문구', isActive: true } }),
    ).toEqual(['headline: 없음 → 새 문구', 'isActive: 없음 → 예']);
    expect(describeChanges({ before: { a: 1 }, after: { a: 1 } })).toEqual([]);
  });

  it('after가 없으면 빈 목록이다', () => {
    expect(describeChanges({ before: { a: 1 }, after: null })).toEqual([]);
  });
});

describe('formatLoggedAt', () => {
  it('한국 시간으로 보여 주고, 잘못된 값은 빈 문자열이다', () => {
    expect(formatLoggedAt('2026-10-20T15:30:00.000Z')).toContain('2026');
    expect(formatLoggedAt('not-a-date')).toBe('');
  });
});
