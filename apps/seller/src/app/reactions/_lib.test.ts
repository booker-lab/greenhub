import type { ManagedReview } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { hiddenSummary, hideReasonError, replaceReview, visibleReviewSummary } from './_lib';

function review(overrides: Partial<ManagedReview> = {}): ManagedReview {
  return {
    id: 'order-1_product-1',
    productId: 'product-1',
    rating: 5,
    text: '싱싱해요',
    authorName: '김*린',
    createdAt: '2026-10-17T03:00:00.000Z',
    hidden: false,
    ...overrides,
  };
}

describe('고객 반응 후기 탭 판단', () => {
  it('평균·개수는 숨기지 않은 후기만으로 낸다(공개 별점과 같은 기준)', () => {
    const list = [
      review({ id: 'a', rating: 5 }),
      review({ id: 'b', rating: 4 }),
      review({ id: 'c', rating: 1, hidden: true }),
    ];
    expect(visibleReviewSummary(list)).toEqual({ count: 2, average: 4.5, hiddenCount: 1 });
    expect(visibleReviewSummary([review({ hidden: true })])).toEqual({
      count: 0,
      average: null,
      hiddenCount: 1,
    });
    expect(visibleReviewSummary([])).toEqual({ count: 0, average: null, hiddenCount: 0 });
  });

  it('숨기는 사유는 비울 수 없고 200자를 넘을 수 없다', () => {
    expect(hideReasonError('  ')).toBe('숨기는 사유를 적어 주세요.');
    expect(hideReasonError('가'.repeat(201))).toBe('사유는 200자까지 적을 수 있어요.');
    expect(hideReasonError('가'.repeat(200))).toBeNull();
    expect(hideReasonError(' 광고 글 ')).toBeNull();
  });

  it('숨김 안내는 누가·언제(KST)를 보여준다', () => {
    expect(hiddenSummary(review())).toBeNull();
    // UTC 10/17 15:30 = KST 10/18 00:30
    expect(
      hiddenSummary(
        review({ hidden: true, hiddenByRole: 'seller', hiddenAt: '2026-10-17T15:30:00.000Z' }),
      ),
    ).toBe('판매자가 10월 18일 숨김');
    expect(hiddenSummary(review({ hidden: true, hiddenByRole: 'admin' }))).toBe('관리자가 숨김');
  });

  it('서버가 돌려준 후기로 같은 id만 바꾼다', () => {
    const list = [review({ id: 'a' }), review({ id: 'b' })];
    const next = replaceReview(list, review({ id: 'b', hidden: true, hiddenReason: '광고' }));
    expect(next.map((item) => item.hidden)).toEqual([false, true]);
    expect(list[1]?.hidden).toBe(false);
  });
});
