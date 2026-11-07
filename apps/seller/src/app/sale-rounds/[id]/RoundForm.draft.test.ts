import { describe, expect, it } from 'vitest';
import {
  isRoundDraftDirty,
  parseRoundDraft,
  ROUND_DRAFT_MAX_AGE_MS,
  resolveRoundDraft,
  roundDraftStorageKey,
  serializeRoundDraft,
} from './RoundForm.draft';
import type { FormDraft } from './RoundForm.sections';

const DRAFT: FormDraft = {
  name: '7월 넷째 주 회차',
  orderOpenAt: '2026-07-19T00:00',
  orderCloseAt: '2026-07-20T00:00',
  auctionAt: '2026-07-20T09:00',
  deliveryStartAt: '2026-07-21T00:00',
  deliveryEndAt: '2026-07-21T09:00',
  deliveryRegionEnabled: true,
  maxDeliveryAddresses: 15,
  maxItemQuantity: 30,
  items: [
    {
      key: 'item-a:0',
      productId: 'product-a',
      name: '호접란',
      roundPrice: 39_000,
      saleLimitQuantity: 20,
      displayOrder: 0,
    },
  ],
};

const SAVED_AT = new Date('2026-07-15T03:00:00.000Z');
const SERVER_UPDATED_AT = '2026-07-15T02:00:00.000Z';

describe('roundDraftStorageKey', () => {
  it('가게와 회차별로 키를 나누고 새 회차는 new를 쓴다', () => {
    expect(roundDraftStorageKey('store-a', 'round-a')).toBe('seller_round_draft:store-a:round-a');
    expect(roundDraftStorageKey('store-a', null)).toBe('seller_round_draft:store-a:new');
    expect(roundDraftStorageKey('store-b', null)).not.toBe(roundDraftStorageKey('store-a', null));
    expect(roundDraftStorageKey('store-a', 'round-b')).not.toBe(
      roundDraftStorageKey('store-a', 'round-a'),
    );
  });

  it('구분자가 든 ID끼리 같은 키가 되지 않는다', () => {
    expect(roundDraftStorageKey('a:b', 'c')).not.toBe(roundDraftStorageKey('a', 'b:c'));
  });
});

describe('serializeRoundDraft / parseRoundDraft', () => {
  it('직렬화한 초안을 그대로 읽는다', () => {
    const raw = serializeRoundDraft(DRAFT, SAVED_AT, SERVER_UPDATED_AT);
    expect(parseRoundDraft(raw)).toEqual({
      version: 1,
      savedAt: SAVED_AT.toISOString(),
      baseUpdatedAt: SERVER_UPDATED_AT,
      draft: DRAFT,
    });
  });

  it('입력 중인 문자열 숫자 칸과 새 회차(기준 없음)도 읽는다', () => {
    const draft: FormDraft = {
      ...DRAFT,
      maxItemQuantity: '',
      items: [{ ...DRAFT.items[0], roundPrice: '4' }],
    };
    expect(parseRoundDraft(serializeRoundDraft(draft, SAVED_AT, null))?.draft).toEqual(draft);
  });

  it('없거나 깨지거나 형식이 다른 값은 null이다', () => {
    const valid = JSON.parse(serializeRoundDraft(DRAFT, SAVED_AT, SERVER_UPDATED_AT));
    expect(parseRoundDraft(null)).toBeNull();
    expect(parseRoundDraft('')).toBeNull();
    expect(parseRoundDraft('{not json')).toBeNull();
    expect(parseRoundDraft(JSON.stringify([]))).toBeNull();
    expect(parseRoundDraft(JSON.stringify({ ...valid, version: 2 }))).toBeNull();
    expect(parseRoundDraft(JSON.stringify({ ...valid, savedAt: 'yesterday' }))).toBeNull();
    expect(parseRoundDraft(JSON.stringify({ ...valid, baseUpdatedAt: 7 }))).toBeNull();
    expect(
      parseRoundDraft(JSON.stringify({ ...valid, draft: { ...valid.draft, name: 1 } })),
    ).toBeNull();
    expect(
      parseRoundDraft(
        JSON.stringify({ ...valid, draft: { ...valid.draft, deliveryRegionEnabled: 'yes' } }),
      ),
    ).toBeNull();
    expect(
      parseRoundDraft(
        JSON.stringify({
          ...valid,
          draft: { ...valid.draft, items: [{ ...valid.draft.items[0], roundPrice: null }] },
        }),
      ),
    ).toBeNull();
  });
});

describe('resolveRoundDraft', () => {
  const stored = parseRoundDraft(serializeRoundDraft(DRAFT, SAVED_AT, SERVER_UPDATED_AT));
  const storedNew = parseRoundDraft(serializeRoundDraft(DRAFT, SAVED_AT, null));
  const later = new Date(SAVED_AT.getTime() + 60_000);

  it('저장된 초안이 없으면 none이다', () => {
    expect(resolveRoundDraft({ stored: null, roundUpdatedAt: null, now: later })).toEqual({
      kind: 'none',
    });
  });

  it('서버 회차가 그대로면 수정 화면 초안을 복원한다', () => {
    expect(resolveRoundDraft({ stored, roundUpdatedAt: SERVER_UPDATED_AT, now: later })).toEqual({
      kind: 'restore',
      draft: DRAFT,
    });
  });

  it('기기 시계가 서버보다 늦어도 기준 updatedAt이 같으면 복원한다', () => {
    const slowClockSavedAt = new Date(Date.parse(SERVER_UPDATED_AT) - 5 * 60_000);
    const slowClock = parseRoundDraft(
      serializeRoundDraft(DRAFT, slowClockSavedAt, SERVER_UPDATED_AT),
    );
    expect(
      resolveRoundDraft({
        stored: slowClock,
        roundUpdatedAt: SERVER_UPDATED_AT,
        now: new Date(slowClockSavedAt.getTime() + 60_000),
      }),
    ).toEqual({ kind: 'restore', draft: DRAFT });
  });

  it('새 회차 초안은 서버 updatedAt 없이 복원한다', () => {
    expect(resolveRoundDraft({ stored: storedNew, roundUpdatedAt: null, now: later })).toEqual({
      kind: 'restore',
      draft: DRAFT,
    });
  });

  it('서버 updatedAt이 초안 저장 시각보다 새로우면 서버 값을 우선한다', () => {
    expect(
      resolveRoundDraft({ stored, roundUpdatedAt: '2026-07-15T04:00:00.000Z', now: later }),
    ).toEqual({ kind: 'stale' });
  });

  it('초안의 기준 updatedAt과 서버 updatedAt이 다르면(시계 차이 포함) 서버 값을 우선한다', () => {
    expect(
      resolveRoundDraft({ stored, roundUpdatedAt: '2026-07-15T02:30:00.000Z', now: later }),
    ).toEqual({ kind: 'stale' });
    expect(
      resolveRoundDraft({ stored: storedNew, roundUpdatedAt: SERVER_UPDATED_AT, now: later }),
    ).toEqual({ kind: 'stale' });
  });

  it('보관 기간이 지난 초안은 만료로 버린다', () => {
    const expiredAt = new Date(SAVED_AT.getTime() + ROUND_DRAFT_MAX_AGE_MS + 1);
    const edge = new Date(SAVED_AT.getTime() + ROUND_DRAFT_MAX_AGE_MS);
    expect(resolveRoundDraft({ stored: storedNew, roundUpdatedAt: null, now: expiredAt })).toEqual({
      kind: 'expired',
    });
    expect(
      resolveRoundDraft({ stored, roundUpdatedAt: SERVER_UPDATED_AT, now: expiredAt }),
    ).toEqual({ kind: 'expired' });
    expect(resolveRoundDraft({ stored: storedNew, roundUpdatedAt: null, now: edge }).kind).toBe(
      'restore',
    );
  });
});

describe('isRoundDraftDirty', () => {
  it('같은 입력은 바뀌지 않은 것으로 보고 숫자 15와 문자열 15를 같게 본다', () => {
    expect(isRoundDraftDirty(DRAFT, { ...DRAFT })).toBe(false);
    expect(isRoundDraftDirty({ ...DRAFT, maxDeliveryAddresses: '15' }, DRAFT)).toBe(false);
  });

  it('칸 하나·상품 목록이 바뀌면 바뀐 것으로 본다', () => {
    expect(isRoundDraftDirty({ ...DRAFT, name: '다른 이름' }, DRAFT)).toBe(true);
    expect(isRoundDraftDirty({ ...DRAFT, deliveryRegionEnabled: false }, DRAFT)).toBe(true);
    expect(isRoundDraftDirty({ ...DRAFT, maxItemQuantity: '' }, DRAFT)).toBe(true);
    expect(isRoundDraftDirty({ ...DRAFT, items: [] }, DRAFT)).toBe(true);
    expect(
      isRoundDraftDirty({ ...DRAFT, items: [{ ...DRAFT.items[0], roundPrice: 40_000 }] }, DRAFT),
    ).toBe(true);
  });
});
