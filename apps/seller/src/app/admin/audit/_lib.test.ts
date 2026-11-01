import { describe, expect, it } from 'vitest';
import { actionLabel, describeChanges, formatLoggedAt, targetLabel } from './_lib';

describe('actionLabel', () => {
  it('아는 기록 종류는 한국어 이름을 보여 준다', () => {
    expect(actionLabel('admin.settlement.paid')).toBe('정산 지급');
    expect(actionLabel('admin.order.force_refunded')).toBe('강제 환불');
    expect(actionLabel('admin.order.post_delivery_refunded')).toBe('배송 후 환불');
    expect(actionLabel('admin.partner_inquiry.deleted')).toBe('입점 문의 삭제');
  });

  it('모르는 기록 종류는 원래 값 대신 기타 기록으로 보여 준다', () => {
    expect(actionLabel('admin.future.action')).toBe('기타 기록');
  });
});

describe('targetLabel', () => {
  it('ID는 자르지 않고 전체를 보여 주고, 배너는 종류만 보여 준다', () => {
    expect(targetLabel({ targetType: 'order', targetId: '1234567890abcdef' })).toBe(
      '주문 1234567890abcdef',
    );
    expect(targetLabel({ targetType: 'banner', targetId: 'main_hero' })).toBe('배너');
    expect(targetLabel({ targetType: 'store', targetId: 'abc' })).toBe('판매자 abc');
  });
});

describe('describeChanges', () => {
  it('수수료는 퍼센트로, 참·거짓은 칸별 한국어 뜻으로 보여 준다', () => {
    expect(
      describeChanges({ before: { commissionRate: 0.1 }, after: { commissionRate: 0.155 } }),
    ).toEqual(['수수료율: 10% → 15.5%']);
    expect(describeChanges({ before: { suspended: false }, after: { suspended: true } })).toEqual([
      '정지: 정상 → 정지',
    ]);
  });

  it('이전 값이 없으면 없음으로, 같은 값인 칸은 빼고 보여 준다', () => {
    expect(
      describeChanges({ before: null, after: { headline: '새 문구', isActive: true } }),
    ).toEqual(['제목: 없음 → 새 문구', '배너 노출: 없음 → 노출']);
    expect(describeChanges({ before: { a: 1 }, after: { a: 1 } })).toEqual([]);
  });

  it('after가 없으면 빈 목록이다', () => {
    expect(describeChanges({ before: { a: 1 }, after: null })).toEqual([]);
  });
});

describe('formatLoggedAt', () => {
  it('한국 시간으로 보여 주고, 잘못된 값은 빈 문자열이다', () => {
    expect(formatLoggedAt('2026-10-20T15:30:00.000Z')).toBe('2026-10-21 00:30');
    expect(formatLoggedAt('not-a-date')).toBe('');
  });
});
