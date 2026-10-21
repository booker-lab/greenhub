import { describe, expect, it } from 'vitest';
import { contactHref, formatInquiryDate } from './_lib';

describe('formatInquiryDate', () => {
  it('한국 시각 날짜로 보여 준다(UTC 전날 밤도 한국 다음 날)', () => {
    expect(formatInquiryDate('2026-10-16T15:30:00.000Z')).toBe('2026. 10. 17.');
  });

  it('읽을 수 없는 시각은 빈 문자열', () => {
    expect(formatInquiryDate('')).toBe('');
  });
});

describe('contactHref', () => {
  it('전화번호는 tel:, 이메일은 mailto: 링크', () => {
    expect(contactHref('010-1234-5678')).toBe('tel:01012345678');
    expect(contactHref(' +82 10 1234 5678 ')).toBe('tel:+821012345678');
    expect(contactHref('farm@example.test')).toBe('mailto:farm@example.test');
  });

  it('자유 입력·짧은 숫자는 링크로 만들지 않는다', () => {
    expect(contactHref('카톡 greenfarm')).toBeNull();
    expect(contactHref('1234')).toBeNull();
    expect(contactHref('')).toBeNull();
  });
});
