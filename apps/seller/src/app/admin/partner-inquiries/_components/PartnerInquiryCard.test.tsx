import type { PartnerInquiryItem } from '@greenhub/shared';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PartnerInquiryCard } from './PartnerInquiryCard';

type Props = { children?: ReactNode; onClick?: () => void; href?: string };

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

describe('관리자 입점 문의 카드', () => {
  it('한국 날짜·미연락 상태·누를 수 있는 전화 링크를 보여 준다', () => {
    const { texts, elements } = render(inquiry());
    expect(texts).toContain('2026. 10. 17.');
    expect(texts).toContain('미연락');
    expect(elements.some((element) => element.props.href === 'tel:01012345678')).toBe(true);
  });

  it('연락함 상태면 배지와 되돌리기 버튼을 보이고, 버튼이 각 동작을 부른다', () => {
    const handlers = { toggle: vi.fn(), remove: vi.fn() };
    const { texts, elements } = render(
      inquiry({ contactedAt: '2026-10-18T00:00:00.000Z', contact: 'farm@example.test' }),
      handlers,
    );
    expect(texts).toContain('연락함');
    expect(elements.some((element) => element.props.href === 'mailto:farm@example.test')).toBe(
      true,
    );
    button(elements, '연락 전으로 되돌리기')?.props.onClick?.();
    button(elements, '삭제')?.props.onClick?.();
    expect(handlers.toggle).toHaveBeenCalledTimes(1);
    expect(handlers.remove).toHaveBeenCalledTimes(1);
  });

  it('링크로 만들 수 없는 연락처는 글자로만 보여 준다', () => {
    const { texts, elements } = render(inquiry({ contact: '카톡 greenfarm' }));
    expect(texts).toContain('카톡 greenfarm');
    expect(elements.some((element) => element.props.href)).toBe(false);
  });
});
