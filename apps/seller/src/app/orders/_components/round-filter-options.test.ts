import { describe, expect, it } from 'vitest';
import {
  ALL_ROUNDS_VALUE,
  buildRoundFilterOptions,
  readRoundFilterSelection,
} from './round-filter-options';

const round = (id: string, name: string, orderOpenAt: string, createdAt = orderOpenAt) => ({
  id,
  name,
  createdAt,
  schedule: {
    orderOpenAt,
    orderCloseAt: orderOpenAt,
    auctionAt: orderOpenAt,
    deliveryStartAt: orderOpenAt,
    deliveryEndAt: orderOpenAt,
    timezone: 'Asia/Seoul' as const,
  },
});

describe('주문 화면 회차 선택 항목', () => {
  it('"전체 회차"를 맨 앞에 두고 최근 회차부터 보인다', () => {
    const options = buildRoundFilterOptions(
      [
        round('r1', '1회차', '2026-10-01T00:00:00.000Z'),
        round('r3', '3회차', '2026-11-01T00:00:00.000Z'),
        round('r2', '2회차', '2026-10-15T00:00:00.000Z'),
      ],
      null,
    );
    expect(options).toEqual([
      { value: ALL_ROUNDS_VALUE, label: '전체 회차' },
      { value: 'r3', label: '3회차' },
      { value: 'r2', label: '2회차' },
      { value: 'r1', label: '1회차' },
    ]);
  });

  it('주문 시작이 같으면 나중에 만든 회차가 먼저다', () => {
    const options = buildRoundFilterOptions(
      [
        round('old', '먼저 만든', '2026-11-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
        round('new', '나중 만든', '2026-11-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
      ],
      null,
    );
    expect(options.map((option) => option.value)).toEqual([ALL_ROUNDS_VALUE, 'new', 'old']);
  });

  it('목록에 없는 딥링크 회차는 "선택한 회차"로 남긴다', () => {
    const options = buildRoundFilterOptions(
      [round('r1', '1회차', '2026-10-01T00:00:00.000Z')],
      'deep',
    );
    expect(options).toEqual([
      { value: ALL_ROUNDS_VALUE, label: '전체 회차' },
      { value: 'deep', label: '선택한 회차' },
      { value: 'r1', label: '1회차' },
    ]);
  });

  it('선택된 회차가 목록에 있으면 중복으로 넣지 않는다', () => {
    const options = buildRoundFilterOptions(
      [round('r1', '1회차', '2026-10-01T00:00:00.000Z')],
      'r1',
    );
    expect(options.map((option) => option.value)).toEqual([ALL_ROUNDS_VALUE, 'r1']);
  });

  it('원래 회차 배열 순서를 바꾸지 않는다', () => {
    const rounds = [
      round('r1', '1회차', '2026-10-01T00:00:00.000Z'),
      round('r2', '2회차', '2026-11-01T00:00:00.000Z'),
    ];
    buildRoundFilterOptions(rounds, null);
    expect(rounds.map((item) => item.id)).toEqual(['r1', 'r2']);
  });

  it('"전체 회차"는 필터 없음, 그 밖의 값은 회차 id다', () => {
    expect(readRoundFilterSelection(ALL_ROUNDS_VALUE)).toBeNull();
    expect(readRoundFilterSelection('r1')).toBe('r1');
  });
});
