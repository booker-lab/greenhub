import type { SaleRoundSchedule } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import type { CreateSaleRoundInput } from '@/hooks/useSaleRounds';
import {
  parseKstDateTimeInput,
  toKstDateTimeInput,
  validateRoundFormInput,
} from './RoundForm.logic';

const VALID_INPUT: CreateSaleRoundInput = {
  name: '7월 넷째 주 회차',
  schedule: {
    orderOpenAt: '2026-07-18T15:00:00.000Z',
    orderCloseAt: '2026-07-19T15:00:00.000Z',
    auctionAt: '2026-07-20T00:00:00.000Z',
    deliveryStartAt: '2026-07-20T15:00:00.000Z',
    deliveryEndAt: '2026-07-21T00:00:00.000Z',
    timezone: 'Asia/Seoul',
  },
  deliveryRegion: {
    id: 'icheon',
    label: '경기도 이천시',
    province: '경기도',
    city: '이천시',
    enabled: true,
  },
  limits: {
    maxDeliveryAddresses: 15,
    maxItemQuantity: 30,
  },
  items: [
    {
      productId: 'product-a',
      roundPrice: 39_000,
      saleLimitQuantity: 20,
      displayOrder: 0,
    },
    {
      productId: 'product-b',
      roundPrice: 45_000,
      saleLimitQuantity: 10,
      displayOrder: 1,
    },
  ],
  carrotLandingUrl: 'https://greenlove.co.kr/?round=round-a',
};

function withSchedule(schedule: SaleRoundSchedule): CreateSaleRoundInput {
  return { ...VALID_INPUT, schedule };
}

describe('RoundForm 검증', () => {
  it('Asia/Seoul 로컬 입력을 손실 없이 ISO8601로 변환한다', () => {
    expect(parseKstDateTimeInput('2026-07-20T00:00')).toBe('2026-07-19T15:00:00.000Z');
    expect(toKstDateTimeInput('2026-07-19T15:00:00.000Z')).toBe('2026-07-20T00:00');
    expect(parseKstDateTimeInput('2026-02-31T09:00')).toBeNull();
  });

  it('유효한 전체 편집 입력과 비활성 배송 지역을 허용한다', () => {
    expect(validateRoundFormInput(VALID_INPUT)).toEqual([]);
    expect(
      validateRoundFormInput({
        ...VALID_INPUT,
        deliveryRegion: { ...VALID_INPUT.deliveryRegion, enabled: false },
      }),
    ).toEqual([]);
  });

  it.each([
    ['주문 시작과 주문 마감이 같은 경우', { orderOpenAt: VALID_INPUT.schedule.orderCloseAt }],
    ['주문 마감이 경매보다 늦은 경우', { orderCloseAt: '2026-07-20T01:00:00.000Z' }],
    ['경매가 배송 시작보다 늦은 경우', { auctionAt: '2026-07-20T16:00:00.000Z' }],
    ['배송 시작과 배송 종료가 같은 경우', { deliveryStartAt: VALID_INPUT.schedule.deliveryEndAt }],
  ])('%s 일정 순서를 거부한다', (_, patch) => {
    const schedule = { ...VALID_INPUT.schedule, ...patch };
    expect(validateRoundFormInput(withSchedule(schedule))).toContain(
      '일정 순서를 확인해 주세요. 주문 시작 < 주문 마감 <= 경매 시각 <= 배송 시작 < 배송 종료여야 합니다.',
    );
  });

  it('Asia/Seoul이 아닌 시간대와 잘못된 URL을 거부한다', () => {
    expect(
      validateRoundFormInput(
        withSchedule({ ...VALID_INPUT.schedule, timezone: 'UTC' } as unknown as SaleRoundSchedule),
      ),
    ).toContain('시간대는 Asia/Seoul이어야 합니다.');
    expect(
      validateRoundFormInput({ ...VALID_INPUT, carrotLandingUrl: 'javascript:alert(1)' }),
    ).toContain('당근 대표 링크는 http 또는 https URL이어야 합니다.');
  });

  it('양수가 아닌 한도·가격과 음수 노출 순서를 거부한다', () => {
    expect(
      validateRoundFormInput({
        ...VALID_INPUT,
        limits: { ...VALID_INPUT.limits, maxDeliveryAddresses: 0 },
      }),
    ).toContain('배송지 한도와 판매 수량 한도는 1 이상의 정수여야 합니다.');
    expect(
      validateRoundFormInput({
        ...VALID_INPUT,
        items: [{ ...VALID_INPUT.items[0], roundPrice: 0 }],
      }),
    ).toContain('각 상품의 회차 가격과 상품별 한도는 1 이상의 정수여야 합니다.');
    expect(
      validateRoundFormInput({
        ...VALID_INPUT,
        items: [{ ...VALID_INPUT.items[0], displayOrder: -1 }],
      }),
    ).toContain('상품 노출 순서는 0 이상의 정수여야 합니다.');
  });

  it('빈 상품 목록과 중복 상품을 거부한다', () => {
    expect(validateRoundFormInput({ ...VALID_INPUT, items: [] })).toContain(
      '회차 상품을 한 개 이상 선택해 주세요.',
    );
    expect(
      validateRoundFormInput({
        ...VALID_INPUT,
        items: [VALID_INPUT.items[0], { ...VALID_INPUT.items[1], productId: 'product-a' }],
      }),
    ).toContain('같은 상품을 회차에 두 번 포함할 수 없습니다.');
  });
});
