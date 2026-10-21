import { describe, expect, it } from 'vitest';
import { describeRecoveryConfirm, isRecoveryPending, sumRecoveryPending, toDateStr } from './_lib';

// 오전/오후 표기는 ICU 버전에 따라 'AM'·'오전'으로 달라질 수 있으므로
// 월·일과 시:분 숫자만 검증한다. 포매터가 timeZone을 고정하므로 실행 환경 시간대와 무관하다.
describe('toDateStr (정산일시 KST 표기)', () => {
  it('UTC 15:00 직전은 KST 같은 날 23:59로 표시한다', () => {
    const text = toDateStr('2026-09-27T14:59:00.000Z');
    expect(text).toContain('9월 27일');
    expect(text).toContain('11:59');
  });

  it('UTC 15:00 직후는 KST 다음 날 0시로 표시한다', () => {
    const text = toDateStr('2026-09-27T15:00:00.000Z');
    expect(text).toContain('9월 28일');
    expect(text).not.toContain('27일');
    expect(text).toContain('12:00');
  });

  it('연말 경계도 KST 기준으로 다음 해 1월 1일로 넘어간다', () => {
    const text = toDateStr('2026-12-31T15:30:00.000Z');
    expect(text).toContain('1월 1일');
    expect(text).toContain('12:30');
  });

  it('Firestore raw 직렬화 `{ _seconds }`도 같은 KST 기준으로 표시한다', () => {
    const seconds = Date.parse('2026-09-27T15:00:00.000Z') / 1000;
    expect(toDateStr({ _seconds: seconds })).toBe(toDateStr('2026-09-27T15:00:00.000Z'));
  });

  it('파싱할 수 없는 값은 "-"로 표시한다', () => {
    expect(toDateStr('not-a-date')).toBe('-');
    expect(toDateStr(null)).toBe('-');
    expect(toDateStr(undefined)).toBe('-');
    expect(toDateStr(12345)).toBe('-');
  });
});

describe('회수 대기 정산', () => {
  const base = {
    id: 's1',
    storeId: 'store-1',
    orderId: 'order-1',
    orderNumber: '20261101-000001',
    totalAmount: 30000,
    platformFee: 1500,
    netAmount: 28500,
    status: 'paid' as const,
    settledAt: null,
    paidAt: null,
  };
  const pending = {
    ...base,
    recovery: {
      status: 'PENDING' as const,
      amount: 28500,
      createdAt: null,
      recoveredAt: null,
      recoveredBy: null,
    },
  };
  const recovered = {
    ...base,
    id: 's2',
    recovery: { ...pending.recovery, status: 'RECOVERED' as const },
  };

  it('회수 대기만 돌려받을 돈으로 센다', () => {
    expect(isRecoveryPending(pending)).toBe(true);
    expect(isRecoveryPending(recovered)).toBe(false);
    expect(isRecoveryPending({ ...base, recovery: null })).toBe(false);
    expect(sumRecoveryPending([pending, recovered, base])).toEqual({ count: 1, amount: 28500 });
  });

  it('회수 완료 확인창은 가게·주문번호·금액을 보여 준다', () => {
    const message = describeRecoveryConfirm(pending);
    expect(message).toContain('가게 ID: store-1');
    expect(message).toContain('주문번호: 20261101-000001');
    expect(message).toContain('돌려받을 돈: ₩28,500');
  });
});
