import type { PartnerInquiryItem } from '@greenhub/shared';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PartnerInquiryCard } from './PartnerInquiryCard';

type MenuItem = { key: string; label: string; onSelect: () => void };
type Props = {
  children?: ReactNode;
  onClick?: () => void;
  href?: string;
  items?: MenuItem[];
};

function inquiry(overrides: Partial<PartnerInquiryItem> = {}): PartnerInquiryItem {
  return {
    id: 'inq-1',
    farmName: '초록농원',
    region: '경기 용인',
    contact: '010-1234-5678',
    message: '호접란을 함께 팔고 싶어요.',
    createdAt: '2026-10-16T15:30:00.000Z',
    contactedAt: null,
    ...overrides,
  };
}

function walk(node: ReactNode): { texts: string[]; elements: ReactElement<Props>[] } {
  const texts: string[] = [];
  const elements: ReactElement<Props>[] = [];
  const visit = (current: ReactNode): void => {
    if (typeof current === 'string' || typeof current === 'number') {
      texts.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (typeof current === 'object' && current !== null && 'props' in current) {
      const element = current as ReactElement<Props>;
      elements.push(element);
      visit(element.props.children);
    }
  };
  visit(node);
  return { texts, elements };
}

const render = (item: PartnerInquiryItem, handlers = { toggle: vi.fn(), remove: vi.fn() }) =>
  walk(
    PartnerInquiryCard({
      item,
      busy: false,
      error: null,
      onToggleContacted: handlers.toggle,
      onDelete: handlers.remove,
    }),
  );

const button = (elements: ReactElement<Props>[], label: string) =>
  elements.find(
    (element) => element.props.onClick && walk(element.props.children).texts.join('') === label,
  );

/** 행 끝 ⋮ 메뉴(AdminRowMenu)의 항목 이름들과 항목. */
const menuItems = (elements: ReactElement<Props>[]) =>
  elements.find((element) => Array.isArray(element.props.items))?.props.items ?? [];

describe('관리자 입점 문의 카드', () => {
  it('한국 날짜(어드민 형식)·미연락 상태·누를 수 있는 전화 링크를 보여 준다', () => {
    const { texts, elements } = render(inquiry());
    expect(texts).toContain('2026-10-17');
    expect(texts).toContain('미연락');
    expect(elements.some((element) => element.props.href === 'tel:01012345678')).toBe(true);
  });

  it('미연락 행은 "연락함으로 표시" 글자 버튼과 ⋮ "삭제…"만 둔다', () => {
    const handlers = { toggle: vi.fn(), remove: vi.fn() };
    const { elements } = render(inquiry(), handlers);
    button(elements, '연락함으로 표시')?.props.onClick?.();
    expect(handlers.toggle).toHaveBeenCalledTimes(1);
    expect(menuItems(elements).map((item) => item.label)).toEqual(['삭제…']);
  });

  it('연락함 상태면 되돌리기·삭제를 ⋮ 메뉴에 두고, 항목이 각 동작을 부른다', () => {
    const handlers = { toggle: vi.fn(), remove: vi.fn() };
    const { texts, elements } = render(
      inquiry({ contactedAt: '2026-10-18T00:00:00.000Z', contact: 'farm@example.test' }),
      handlers,
    );
    expect(texts).toContain('연락함');
    expect(elements.some((element) => element.props.href === 'mailto:farm@example.test')).toBe(
      true,
    );
    expect(button(elements, '연락함으로 표시')).toBeUndefined();
    const items = menuItems(elements);
    expect(items.map((item) => item.label)).toEqual(['연락 전으로 되돌리기', '삭제…']);
    for (const item of items) item.onSelect();
    expect(handlers.toggle).toHaveBeenCalledTimes(1);
    expect(handlers.remove).toHaveBeenCalledTimes(1);
  });

  it('링크로 만들 수 없는 연락처는 글자로만 보여 준다', () => {
    const { texts, elements } = render(inquiry({ contact: '카톡 greenfarm' }));
    expect(texts).toContain('카톡 greenfarm');
    expect(elements.some((element) => element.props.href)).toBe(false);
  });
});
