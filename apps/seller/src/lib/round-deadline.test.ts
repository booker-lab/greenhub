import { describe, expect, it } from 'vitest';
import {
  type DeadlineRound,
  deadlineTarget,
  formatCountdown,
  pickDeadlineRound,
} from './round-deadline';

function round(id: string, status: DeadlineRound['status'], openAt: string, closeAt: string) {
  return {
    id,
    name: `${id} 회차`,
    status,
    schedule: {
      orderOpenAt: openAt,
      orderCloseAt: closeAt,
      auctionAt: closeAt,
      deliveryStartAt: closeAt,
      deliveryEndAt: closeAt,
    },
  } as DeadlineRound;
}

describe('deadlineTarget', () => {
  it('판매 중이면 주문 마감까지, 판매 예정이면 주문 시작까지 센다', () => {
    const open = round('a', 'OPEN', '2026-10-01T01:00:00Z', '2026-10-04T15:00:00Z');
    const scheduled = round('b', 'SCHEDULED', '2026-10-08T01:00:00Z', '2026-10-11T15:00:00Z');
    expect(deadlineTarget(open)).toEqual({ label: '마감까지', at: '2026-10-04T15:00:00Z' });
    expect(deadlineTarget(scheduled)).toEqual({
      label: '주문 시작까지',
      at: '2026-10-08T01:00:00Z',
    });
  });

  it('작성 중·주문 마감·완료·취소 회차는 띠를 숨긴다', () => {
    for (const status of ['DRAFT', 'CLOSED', 'COMPLETED', 'CANCELLED'] as const) {
      expect(
        deadlineTarget(round('x', status, '2026-10-01T01:00:00Z', '2026-10-04T15:00:00Z')),
      ).toBeNull();
    }
  });

  it('띠 문구에 회차 상태 이름을 쓰지 않는다', () => {
    const labels = ['OPEN', 'SCHEDULED'].map(
      (status) =>
        deadlineTarget(
          round(
            'x',
            status as DeadlineRound['status'],
            '2026-10-01T01:00:00Z',
            '2026-10-04T15:00:00Z',
          ),
        )?.label ?? '',
    );
    for (const label of labels) {
      for (const statusName of ['판매 중', '판매 예정', '주문 마감', '작성 중', '배송 완료']) {
        expect(label).not.toContain(statusName);
      }
    }
  });
});

describe('pickDeadlineRound', () => {
  it('판매 중 회차를 판매 예정보다 먼저 고르고, 그중 마감이 가장 이른 것을 고른다', () => {
    const rounds = [
      round('scheduled', 'SCHEDULED', '2026-10-05T01:00:00Z', '2026-10-08T15:00:00Z'),
      round('open-late', 'OPEN', '2026-10-01T01:00:00Z', '2026-10-06T15:00:00Z'),
      round('open-early', 'OPEN', '2026-10-01T01:00:00Z', '2026-10-04T15:00:00Z'),
    ];
    expect(pickDeadlineRound(rounds)?.id).toBe('open-early');
  });

  it('판매 중 회차가 없으면 주문 시작이 가장 이른 판매 예정 회차를 고른다', () => {
    const rounds = [
      round('closed', 'CLOSED', '2026-09-24T01:00:00Z', '2026-09-27T15:00:00Z'),
      round('later', 'SCHEDULED', '2026-10-15T01:00:00Z', '2026-10-18T15:00:00Z'),
      round('sooner', 'SCHEDULED', '2026-10-08T01:00:00Z', '2026-10-11T15:00:00Z'),
    ];
    expect(pickDeadlineRound(rounds)?.id).toBe('sooner');
  });

  it('판매 중·판매 예정 회차가 없으면 null', () => {
    expect(
      pickDeadlineRound([round('draft', 'DRAFT', '2026-10-08T01:00:00Z', '2026-10-11T15:00:00Z')]),
    ).toBeNull();
    expect(pickDeadlineRound([])).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('하루 이상이면 일수를 앞에 붙이고, 지난 시간과 잘못된 값은 0으로 본다', () => {
    expect(formatCountdown(((2 * 24 + 14) * 3600 + 32 * 60 + 7) * 1000)).toBe('2일 14:32:07');
    expect(formatCountdown((3 * 3600 + 5 * 60 + 9) * 1000)).toBe('03:05:09');
    expect(formatCountdown(-5000)).toBe('00:00:00');
    expect(formatCountdown(Number.NaN)).toBe('00:00:00');
  });
});
