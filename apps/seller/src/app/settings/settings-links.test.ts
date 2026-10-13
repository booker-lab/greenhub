import { describe, expect, it } from 'vitest';
import { operationSettingsFor, SELLER_OPERATION_SETTINGS } from './settings-links';

const links = (sections: readonly { links: readonly { href: string; label: string }[] }[]) =>
  sections.flatMap((section) => section.links.map(({ href, label }) => ({ href, label })));

describe('셀러 설정 운영 메뉴', () => {
  it('정산·기존 배송 설정·배송 슬롯·거점 관리 접근을 유지한다', () => {
    expect(links(SELLER_OPERATION_SETTINGS)).toEqual([
      { href: '/settlements', label: '정산 관리' },
      { href: '/settings/delivery', label: '배송비 설정 / 기상 제한' },
      { href: '/settings/daily-caps', label: '배송 슬롯 (Daily Cap)' },
      { href: '/hubs', label: '거점 관리' },
    ]);
  });

  it('예전 판매 방식 가게에는 운영 메뉴를 모두 보인다', () => {
    expect(links(operationSettingsFor('legacy'))).toEqual(links(SELLER_OPERATION_SETTINGS));
  });

  it('회차 판매 가게에는 적용되지 않는 배송비·배송 슬롯·거점 메뉴를 숨긴다', () => {
    expect(links(operationSettingsFor('round_direct'))).toEqual([
      { href: '/settlements', label: '정산 관리' },
    ]);
  });

  it('판매 방식을 확인하기 전에는 공통 메뉴만 보인다', () => {
    expect(links(operationSettingsFor(undefined))).toEqual([
      { href: '/settlements', label: '정산 관리' },
    ]);
  });
});
