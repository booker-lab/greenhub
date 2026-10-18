import type { AdminHiddenReview } from '@greenhub/shared';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HiddenReviewCard } from './HiddenReviewCard';

type Props = { children?: ReactNode; onClick?: () => void };

function hidden(overrides: Partial<AdminHiddenReview> = {}): AdminHiddenReview {
  return {
    id: 'order-1_product-1',
    productId: 'product-1',
    rating: 1,
    text: '연락 주세요 010-0000-0000',
    authorName: '김*린',
    createdAt: '2026-10-16T03:00:00.000Z',
    hidden: true,
    hiddenReasonCode: 'privacy',
    hiddenNote: '전화번호 노출',
    hiddenByRole: 'seller',
    hiddenAt: '2026-10-17T15:30:00.000Z',
    storeId: 'store-1',
    storeName: '초록농원',
    productName: '호접란 빅립',
    ...overrides,
  };
}

function isElement(node: ReactNode): node is ReactElement<Props> {
  return typeof node === 'object' && node !== null && 'props' in node;
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
    if (isElement(current)) {
      elements.push(current);
      visit(current.props.children);
    }
  };
  visit(node);
  return { texts, elements };
}

describe('관리자 숨긴 후기 카드', () => {
  it('가게·상품·별점·내용·사유 분류·설명·숨긴 사람/시각을 보여준다', () => {
    const { texts } = walk(
      HiddenReviewCard({ review: hidden(), busy: false, error: null, onUnhide: () => {} }),
    );
    const joined = texts.join('');
    for (const expected of [
      '초록농원',
      '호접란 빅립',
      '★',
      '연락 주세요 010-0000-0000',
      '사유: 개인정보 노출',
      '설명: 전화번호 노출',
      '판매자가 10월 18일 숨김',
    ]) {
      expect(joined).toContain(expected);
    }
  });

  it('숨김 해제 버튼이 있고, 이름을 모르면 가게 id·삭제된 상품으로 보여준다', () => {
    const onUnhide = vi.fn();
    const { texts, elements } = walk(
      HiddenReviewCard({
        review: hidden({ storeName: null, productName: null, hiddenNote: undefined }),
        busy: false,
        error: '권한이 없습니다.',
        onUnhide,
      }),
    );
    const joined = texts.join('');
    expect(joined).toContain('store-1');
    expect(joined).toContain('삭제된 상품');
    expect(joined).not.toContain('설명:');
    expect(texts).toContain('권한이 없습니다.');
    const unhide = elements.find(
      (element) =>
        element.props.onClick && walk(element.props.children).texts.join('') === '숨김 해제',
    );
    unhide?.props.onClick?.();
    expect(onUnhide).toHaveBeenCalledTimes(1);
  });
});
