import type { ManagedReview } from '@greenhub/shared';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RadioItem, ReviewCard, type ReviewCardProps } from './ReviewCard';

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

type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (value: string) => void;
  'aria-label'?: string;
  label?: ReactNode;
  value?: string | null;
  disabled?: boolean;
};

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
    onNoteChange: vi.fn(),
    onCancel: vi.fn(),
    onConfirmHide: vi.fn(),
  };
  const tree = ReviewCard({
    review: review(),
    editing: false,
    reasonCode: null,
    note: '',
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

  it('숨기기를 누르면 안내 문구·네 가지 사유 선택·설명(선택)·확인/취소가 나온다', () => {
    const { texts, elements, button, handlers } = render({ editing: true });
    expect(texts.join('')).toContain('불만이나 낮은 별점이라는 이유로는 숨길 수 없어요');
    const radios = elements.filter((element) => element.type === RadioItem);
    expect(radios.map((radio) => radio.props.label)).toEqual([
      '광고·스팸',
      '욕설·비방',
      '개인정보 노출',
      '상품과 무관',
    ]);
    expect(texts).toContain('숨기는 사유');
    const abuse = radios.find((radio) => radio.props.label === '욕설·비방');
    (abuse?.props.onChange as (() => void) | undefined)?.();
    expect(handlers.onReasonChange).toHaveBeenCalledWith('abuse');
    expect(texts).toContain('설명(선택)');
    expect(button('숨기기')).toBeUndefined();
    // 사유를 고르기 전에는 확인 버튼이 꺼져 있다.
    expect(button('숨기기 확인')?.props.disabled).toBe(true);
    button('취소')?.props.onClick?.();
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('사유를 고르면 숨기기 확인을 누를 수 있다', () => {
    const { button, handlers } = render({ editing: true, reasonCode: 'spam' });
    expect(button('숨기기 확인')?.props.disabled).toBe(false);
    button('숨기기 확인')?.props.onClick?.();
    expect(handlers.onConfirmHide).toHaveBeenCalledTimes(1);
  });

  it('숨긴 후기는 숨김 배지·누가·언제·사유·설명을 보여주고, 판매자 화면에는 해제 버튼이 없다', () => {
    const { texts, button } = render({
      review: review({
        hidden: true,
        hiddenReasonCode: 'spam',
        hiddenNote: '다른 가게 홍보',
        hiddenByRole: 'seller',
        hiddenAt: '2026-10-17T15:30:00.000Z',
      }),
    });
    const joined = texts.join('');
    expect(texts).toContain('숨김');
    expect(joined).toContain('판매자가 10월 18일 숨김');
    expect(joined).toContain('사유: 광고·스팸 · 다른 가게 홍보');
    expect(joined).toContain('관리자에게 요청');
    expect(button('숨기기')).toBeUndefined();
    expect(button('숨김 해제')).toBeUndefined();
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
