import { aggregateSettlements } from './settlement-aggregator';

describe('aggregateSettlements 회수 대기 집계', () => {
  it('회수 대기(PENDING)만 건수·금액에 넣고 회수 완료(RECOVERED)와 기록 없음은 뺀다', () => {
    const agg = aggregateSettlements([
      { status: 'paid', totalAmount: 10000, platformFee: 500, netAmount: 9500 },
      {
        status: 'paid',
        totalAmount: 20000,
        platformFee: 1000,
        netAmount: 19000,
        recovery: { status: 'PENDING', amount: 19000 },
      },
      {
        status: 'paid',
        totalAmount: 30000,
        platformFee: 1500,
        netAmount: 28500,
        recovery: { status: 'RECOVERED', amount: 28500 },
      },
      { status: 'cancelled', totalAmount: 5000, platformFee: 250, netAmount: 4750 },
    ]);

    expect(agg.recoveryPendingCount).toBe(1);
    expect(agg.recoveryPendingAmount).toBe(19000);
    expect(agg.byStatus).toEqual({ pending: 0, confirmed: 0, paid: 3, cancelled: 1 });
    expect(agg.count).toBe(4);
  });

  it('회수 기록이 하나도 없으면 0건·0원이다', () => {
    const agg = aggregateSettlements([{ status: 'pending', netAmount: 9500 }]);
    expect(agg.recoveryPendingCount).toBe(0);
    expect(agg.recoveryPendingAmount).toBe(0);
  });
});
