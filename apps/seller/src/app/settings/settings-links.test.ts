import { describe, expect, it } from 'vitest';
import { SELLER_OPERATION_SETTINGS } from './settings-links';

describe('셀러 설정 운영 메뉴', () => {
  it('정산·기존 배송 설정·배송 슬롯·거점 관리 접근을 유지한다', () => {
    expect(
      SELLER_OPERATION_SETTINGS.flatMap((section) =>
        section.links.map(({ href, label }) => ({ href, label })),
      ),
    ).toEqual([
      { href: '/settlements', label: '정산 관리' },
      { href: '/settings/delivery', label: '배송비 설정 / 기상 제한' },
      { href: '/settings/daily-caps', label: '배송 슬롯 (Daily Cap)' },
      { href: '/hubs', label: '거점 관리' },
    ]);
  });
});
