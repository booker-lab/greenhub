import type { ManagedReview } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import {
  buildHideRequest,
  HIDE_POLICY_NOTE,
  HIDE_REASON_OPTIONS,
  hiddenReasonLabel,
  hiddenSummary,
  replaceReview,
  visibleReviewSummary,
} from './_lib';

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

  it('숨김 사유는 정해진 네 가지 목록뿐이고, 낮은 별점·불만은 숨길 수 없다고 안내한다', () => {
    expect(HIDE_REASON_OPTIONS.map((option) => option.label)).toEqual([
      '광고·스팸',
      '욕설·비방',
      '개인정보 노출',
      '상품과 무관',
    ]);
    expect(HIDE_POLICY_NOTE).toContain('불만이나 낮은 별점');
  });

  it('사유를 고르지 않았거나 목록 밖이면 막고, 설명은 선택이며 200자까지다', () => {
    expect(buildHideRequest(null, '')).toEqual({ body: null, error: '숨기는 사유를 골라 주세요.' });
    expect(buildHideRequest('low-rating', '')).toMatchObject({ body: null });
    expect(buildHideRequest('spam', '가'.repeat(201))).toEqual({
      body: null,
      error: '설명은 200자까지 적을 수 있어요.',
    });
    expect(buildHideRequest('spam', '  ')).toEqual({ body: { reasonCode: 'spam' }, error: null });
    expect(buildHideRequest('privacy', ' 전화번호 노출 ')).toEqual({
      body: { reasonCode: 'privacy', note: '전화번호 노출' },
      error: null,
    });
  });

  it('숨김 안내는 누가·언제(KST)와 사유 분류 이름을 보여준다', () => {
    expect(hiddenSummary(review())).toBeNull();
    // UTC 10/17 15:30 = KST 10/18 00:30
    expect(
      hiddenSummary(
        review({ hidden: true, hiddenByRole: 'seller', hiddenAt: '2026-10-17T15:30:00.000Z' }),
      ),
    ).toBe('판매자가 10월 18일 숨김');
    expect(hiddenSummary(review({ hidden: true, hiddenByRole: 'admin' }))).toBe('관리자가 숨김');
    expect(hiddenReasonLabel({ hiddenReasonCode: 'off-topic' })).toBe('상품과 무관');
    expect(hiddenReasonLabel({})).toBeNull();
  });

  it('서버가 돌려준 후기로 같은 id만 바꾼다', () => {
    const list = [review({ id: 'a' }), review({ id: 'b' })];
    const next = replaceReview(list, review({ id: 'b', hidden: true, hiddenReasonCode: 'spam' }));
    expect(next.map((item) => item.hidden)).toEqual([false, true]);
    expect(list[1]?.hidden).toBe(false);
  });
});
