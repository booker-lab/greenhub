// Round cancellation OCC retry-purity proofs on the canonical harness.
// Task: PILOT-CANCELLATION-TRANSACTION-RETRY-PURITY-27B
//
// Proves COMMITTED_CALLBACK_RETURN_ONLY for
// RoundOrderLifecycleService.claimCancellation / applyLocalCancellation:
//   R1. aborted done/needsRefund never pollutes committed LOCAL_PENDING retry
//   R2. LOCAL_PENDING retry consumes only the committed needsRefund
//   R3. happy cancellation semantics preserved
//
// Uses only the canonical harness at ../../test/helpers/firestore-occ-fake.
// PortOne is mocked; no Firebase external calls.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Occ = ReturnType<typeof createOccFirestore>;

const ORDER_ID = 'order-1';
const ORDER_PATH = `orders/${ORDER_ID}`;
const PAYMENT_PATH = `payments/${ORDER_ID}`;

function makeService(occ: Occ) {
  let providerCalls = 0;
  const payments = {
    processRefundByOrderId: jest.fn(async (orderId: string) => {
      providerCalls += 1;
      // Simulate provider success converging the payment doc so the retry
      // observes refunded state (paymentIsPaid === false afterwards).
      const current = occ.getData(PAYMENT_PATH);
      if (current) {
        occ.updateOutsideTransaction(PAYMENT_PATH, {
          refundedAt: new Date().toISOString(),
        });
      }
    }),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
    __providerCalls: () => providerCalls,
  };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const capacity = {
    releaseForOrderCancellationInTransaction: jest
      .fn()
      .mockResolvedValue({ reservation: { status: 'RELEASED' }, counters: null }),
    adjustHeldOrderCountInTransaction: jest.fn().mockResolvedValue({}),
  };
  const service = new RoundOrderLifecycleService(
    occ.firestore as never,
    payments as never,
    settlements as never,
    capacity as never,
  );
  return { service, payments, settlements, capacity };
}

function seedOrder(
  occ: Occ,
  order: Record<string, unknown>,
  payment?: Record<string, unknown> | null,
) {
  occ.seed(ORDER_PATH, {
    id: ORDER_ID,
    storeId: 'store-1',
    userId: 'user-1',
    ...order,
  });
  if (payment) {
    occ.seed(PAYMENT_PATH, {
      id: ORDER_ID,
      orderId: ORDER_ID,
      storeId: 'store-1',
      ...payment,
    });
  }
}

describe('round cancellation OCC retry purity', () => {
  it('R1. aborted done never pollutes committed LOCAL_FAILED retry', async () => {
    const occ = createOccFirestore();
    // Attempt 1 observes DONE (CANCELLED + COMPLETED, unpaid).
    seedOrder(occ, {
      status: 'CANCELLED',
      cancellation: {
        status: 'COMPLETED',
        reason: '소비자 취소',
        completedAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    });
    const { service, payments, settlements } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // Force attempt 1 (done, 0 writes) to abort. The retry observes
          // LOCAL_FAILED, a path that stages no claim write in the old code
          // and would have leaked stale done without committed-return.
          occ.updateOutsideTransaction(ORDER_PATH, {
            status: 'ACCEPTED',
            cancellation: {
              status: 'LOCAL_FAILED',
              reason: '소비자 취소',
              updatedAt: new Date().toISOString(),
            },
          });
        }
        arm();
      });
    };
    arm();

    await expect(
      service.cancelForRound({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'ACCEPTED' as never,
        reason: '소비자 취소',
      }),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });
    occ.clearHooks();

    expect(commits.length).toBeGreaterThanOrEqual(3);
    expect(commits[0].writeCount).toBe(0);
    // Stale done must not early-return: the committed LOCAL_FAILED retry
    // drives applyLocal to convergence.
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });

  it('R2. LOCAL_PENDING retry consumes only the committed needsRefund (paid -> refund once)', async () => {
    const occ = createOccFirestore();
    seedOrder(
      occ,
      {
        status: 'ACCEPTED',
        cancellation: {
          status: 'LOCAL_PENDING',
          reason: '소비자 취소',
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 'PAID', amount: { total: 100000 } },
    );
    const { service, payments, settlements } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // Neutral version bump forces the claim attempt to abort without
          // changing cancellation/payment semantics. The committed retry
          // must supply needsRefund=false, then applyLocal observes PAID and
          // supplies needsRefund=true exactly once.
          occ.updateOutsideTransaction(ORDER_PATH, { probe: 1 });
        }
        arm();
      });
    };
    arm();

    await expect(
      service.cancelForRound({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'ACCEPTED' as never,
        reason: '소비자 취소',
      }),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });
    occ.clearHooks();

    expect(commits.length).toBeGreaterThanOrEqual(3);
    // Exactly one provider refund despite the aborted claim attempt.
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.__providerCalls()).toBe(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });

  it('R2b. LOCAL_FAILED unpaid retry converges without refund', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, {
      status: 'ACCEPTED',
      cancellation: {
        status: 'LOCAL_FAILED',
        reason: '소비자 취소',
        updatedAt: new Date().toISOString(),
      },
    });
    const { service, payments, settlements } = makeService(occ);

    await expect(
      service.cancelForRound({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'ACCEPTED' as never,
        reason: '소비자 취소',
      }),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });

  it('R3. happy cancellation preserved (PENDING unpaid -> no refund, direct complete)', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'PENDING' });
    const { service, payments, settlements } = makeService(occ);

    await expect(
      service.cancelForRound({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'PENDING' as never,
        reason: '소비자 취소',
      }),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: '소비자 취소',
      cancellation: { status: 'COMPLETED', reason: '소비자 취소' },
    });
  });

  it('R3b. happy cancellation preserved (ACCEPTED paid -> refund once then complete)', async () => {
    const occ = createOccFirestore();
    seedOrder(
      occ,
      { status: 'ACCEPTED' },
      { status: 'PAID', amount: { total: 100000 } },
    );
    const { service, payments, settlements } = makeService(occ);

    await expect(
      service.cancelForRound({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'ACCEPTED' as never,
        reason: '소비자 취소',
      }),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.__providerCalls()).toBe(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });
});
