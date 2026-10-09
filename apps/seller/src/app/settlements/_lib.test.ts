import { describe, expect, it } from 'vitest';
import { buildSettlementCsv, csvCell, toDateStr, toKSTISO } from './_lib';

// 오전/오후 표기는 ICU 버전에 따라 달라질 수 있어 월·일과 시:분 숫자만 검증한다.
// 포매터가 timeZone을 고정하므로 실행 환경 시간대와 무관하다.
describe('toDateStr (셀러 정산일시 KST 표기)', () => {
  it('UTC 15:00 직전은 KST 같은 날 23:59로 표시한다', () => {
    const text = toDateStr('2026-09-27T14:59:00.000Z');
    expect(text).toContain('9월 27일');
    expect(text).toContain('11:59');
  });

  it('UTC 15:00 직후는 KST 다음 날 0시로 표시한다', () => {
    const text = toDateStr('2026-09-27T15:00:00.000Z');
    expect(text).toContain('9월 28일');
    expect(text).not.toContain('27일');
  });

  it('초 단위 숫자와 `{ _seconds }`도 같은 KST 기준으로 표시한다', () => {
    const seconds = Date.parse('2026-09-27T15:00:00.000Z') / 1000;
    const expected = toDateStr('2026-09-27T15:00:00.000Z');
    expect(toDateStr(seconds)).toBe(expected);
    expect(toDateStr({ _seconds: seconds })).toBe(expected);
  });

  it('파싱할 수 없는 값은 "-"로 표시한다', () => {
    expect(toDateStr('not-a-date')).toBe('-');
    expect(toDateStr(null)).toBe('-');
  });
});

describe('toKSTISO (CSV 정산일시)', () => {
  it('KST 오프셋을 붙여 KST 날짜로 기록한다', () => {
    expect(toKSTISO('2026-09-27T15:00:00.000Z')).toBe('2026-09-28T00:00:00+09:00');
    expect(toKSTISO('2026-12-31T15:30:00.000Z')).toBe('2027-01-01T00:30:00+09:00');
  });

  it('같은 순간을 가리킨다(Date로 다시 읽으면 원래 시각)', () => {
    const iso = '2026-09-27T14:59:00.000Z';
    expect(new Date(toKSTISO(iso)).toISOString()).toBe(iso);
  });

  it('초 단위 숫자·`{ _seconds }`를 처리하고 파싱 불가는 빈 문자열', () => {
    const seconds = Date.parse('2026-09-27T15:00:00.000Z') / 1000;
    expect(toKSTISO(seconds)).toBe('2026-09-28T00:00:00+09:00');
    expect(toKSTISO({ _seconds: seconds })).toBe('2026-09-28T00:00:00+09:00');
    expect(toKSTISO('bad')).toBe('');
  });
});

describe('정산 CSV', () => {
  it('주문번호를 마지막 칸에 싣고 기존 칸 순서는 유지한다', () => {
    const csv = buildSettlementCsv([
      {
        id: 'o1',
        orderId: 'o1',
        orderNumber: '20261110-000001',
        totalAmount: 30000,
        platformFee: 1500,
        netAmount: 28500,
        status: 'pending',
        settledAt: '2026-09-27T15:00:00.000Z',
      },
      {
        id: 'o2',
        orderId: 'o2',
        totalAmount: 25000,
        platformFee: 1250,
        netAmount: 23750,
        status: 'confirmed',
        settledAt: '2026-09-27T15:00:00.000Z',
      },
    ]);
    const [header, first, second] = csv.split('\n');
    expect(header).toBe('주문ID,정산일시,총금액,플랫폼수수료,정산액,상태,주문번호');
    expect(first.startsWith('o1,2026-09-28T00:00:00+09:00,30000,1500,28500,')).toBe(true);
    expect(first.endsWith(',20261110-000001')).toBe(true);
    expect(second.endsWith(',')).toBe(true);
  });

  it('쉼표·따옴표는 감싸고 수식 시작 문자는 무력화한다', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(-1500)).toBe('-1500');
    expect(csvCell(null)).toBe('');
  });
});
