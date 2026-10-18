import type { ManagedReview } from '@greenhub/shared';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewCard, type ReviewCardProps } from './ReviewCard';

function review(overrides: Partial<ManagedReview> = {}): ManagedReview {
  return {
    id: 'order-1_product-1',
    productId: 'product-1',
    rating: 4,
    text: '꽃이 커요',
    authorName: '김*린',
    createdAt: '2026-10-17T03:00:00.000Z',
    hidden: false,
    photoUrls: [],
    ...overrides,
  };
}

type Props = { children?: ReactNode; onClick?: () => void; 'aria-label'?: string };

function isElement(node: ReactNode): node is ReactElement<Props> {
  return typeof node === 'object' && node !== null && 'props' in node;
}

/** 렌더 트리(DOM 불필요)의 텍스트 리프와 요소를 모은다. */
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
    if (isElement(current)) {
      elements.push(current);
      visit(current.props.children);
    }
  };
  visit(node);
  return { texts, elements };
}

const textOf = (element: ReactElement<Props>) => walk(element.props.children).texts.join('');

function render(overrides: Partial<ReviewCardProps> = {}) {
  const handlers = {
    onStartHide: vi.fn(),
    onReasonChange: vi.fn(),
    onCancel: vi.fn(),
    onConfirmHide: vi.fn(),
    onUnhide: vi.fn(),
  };
  const tree = ReviewCard({
    review: review(),
    editing: false,
    reason: '',
    busy: false,
    error: null,
    ...handlers,
    ...overrides,
  });
  const { texts, elements } = walk(tree);
  const button = (label: string) =>
    elements.find((element) => element.props.onClick && textOf(element) === label);
  return { texts, elements, button, handlers };
}

describe('고객 반응 후기 카드 숨기기', () => {
  it('보이는 후기에는 숨기기 버튼만 있고 숨김 표시는 없다', () => {
    const { texts, button, handlers } = render();
    expect(texts).not.toContain('숨김');
    expect(button('숨김 해제')).toBeUndefined();
    button('숨기기')?.props.onClick?.();
    expect(handlers.onStartHide).toHaveBeenCalledTimes(1);
  });

  it('숨기기를 누르면 사유 입력과 확인·취소 버튼이 나온다', () => {
    const { elements, button, handlers } = render({ editing: true, reason: '광고' });
    expect(elements.some((element) => element.props['aria-label'] === '숨기는 사유')).toBe(true);
    expect(button('숨기기')).toBeUndefined();
    button('숨기기 확인')?.props.onClick?.();
    button('취소')?.props.onClick?.();
    expect(handlers.onConfirmHide).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('숨긴 후기는 숨김 배지·누가·언제·사유와 숨김 해제 버튼을 보여준다', () => {
    const { texts, button, handlers } = render({
      review: review({
        hidden: true,
        hiddenReason: '상품과 관계없는 광고',
        hiddenByRole: 'admin',
        hiddenAt: '2026-10-17T15:30:00.000Z',
      }),
    });
    expect(texts).toContain('숨김');
    expect(texts.join('')).toContain('관리자가 10월 18일 숨김');
    expect(texts.join('')).toContain('사유: 상품과 관계없는 광고');
    expect(button('숨기기')).toBeUndefined();
    button('숨김 해제')?.props.onClick?.();
    expect(handlers.onUnhide).toHaveBeenCalledTimes(1);
  });

  it('후기 사진과 오류 문구를 보여준다', () => {
    const { elements, texts } = render({
      review: review({
        photoUrls: ['https://signed.example.invalid/a', 'https://signed.example.invalid/b'],
      }),
      error: '권한이 없습니다.',
    });
    expect(elements.filter((element) => element.type === 'img')).toHaveLength(2);
    expect(texts).toContain('권한이 없습니다.');
  });
});
