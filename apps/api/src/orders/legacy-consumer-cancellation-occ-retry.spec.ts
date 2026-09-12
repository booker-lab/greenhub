// Legacy consumer cancellation OCC retry-purity proofs on the canonical harness.
// Task: PILOT-CANCELLATION-TRANSACTION-RETRY-PURITY-27B
//
// Proves COMMITTED_CALLBACK_RETURN_ONLY for
// OrdersLifecycleService.claimLegacyConsumerCancellation:
//   L1. aborted done -> committed claim (stale done must not escape)
//   L2. aborted in_progress -> committed claim (stale in_progress must not escape)
//   L3. aborted claim -> committed foreign (aborted token must not call provider)
//
// Uses only the canonical harness at ../../test/helpers/firestore-occ-fake
// (per-doc versions, conflict detection, bounded retry, staged-write discard,
// beforeCommit deterministic interleaving). No serial fakes, no timers.
// PortOne is mocked; no Firebase external calls.

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import type { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Occ = ReturnType<typeof createOccFirestore>;

const ORDER_ID = 'order-1';
const ORDER_PATH = `orders/${ORDER_ID}`;
const GC_PATH = 'groupProductConfig/product-1';

function makeService(occ: Occ) {
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const capacity = {};
  const roundLifecycle = {
    cancelByConsumer: jest.fn(),
  };
  const service = new OrdersLifecycleService(
    occ.firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle as unknown as RoundOrderLifecycleService,
  );
  return { service, notifications, payments, settlements };
}

function seedClaimable(occ: Occ) {
  occ.seed(ORDER_PATH, {
    id: ORDER_ID,
    storeId: 'store-1',
    userId: 'consumer-1',
    productId: 'product-1',
    quantity: 2,
    status: 'RECRUITING',
    saleType: 'group',
    deliveryMethod: 'direct',
    totalAmount: 50000,
  });
  occ.seed(GC_PATH, {
    productId: 'product-1',
    currentQuantity: 5,
    minQuantity: 2,
    targetQuantity: 10,
  });
}

function seedDone(occ: Occ) {
  occ.seed(ORDER_PATH, {
    id: ORDER_ID,
    storeId: 'store-1',
    userId: 'consumer-1',
    productId: 'product-1',
    quantity: 2,
    status: 'CANCELLED',
    saleType: 'group',
    deliveryMethod: 'direct',
    totalAmount: 50000,
    cancellation: {
      status: 'COMPLETED',
      reason: '변심',
      completedAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
  });
  occ.seed(GC_PATH, {
    productId: 'product-1',
    currentQuantity: 3,
    minQuantity: 2,
    targetQuantity: 10,
  });
}

describe('legacy consumer cancellation OCC retry purity', () => {
  it('L1. aborted done -> committed claim: caller consumes claimed, refund runs once', async () => {
    const occ = createOccFirestore();
    seedDone(occ);
    const { service, payments, settlements, notifications } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // Attempt 1 observed DONE (0 writes). Make the live order claimable
          // before validation so attempt 1 aborts and the retry must claim.
          occ.updateOutsideTransaction(ORDER_PATH, {
            status: 'RECRUITING',
            cancellation: null,
          });
        }
        arm();
      });
    };
    arm();

    await expect(
      service.cancelOrder('store-1', ORDER_ID, 'consumer-1', '변심'),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });
    occ.clearHooks();

    // Attempt 1 (done, 0 writes, aborted) + attempt 2 (claim, 1 write,
    // committed) + apply-local commit.
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0].writeCount).toBe(0);
    expect(commits[1].writeCount).toBe(1);
    // Old outer-mutation code returned stale done here: provider 0 with an
    // orphaned REFUNDING claim left behind. Committed-return must claim and
    // drive the refund path.
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledWith(ORDER_ID, '변심');
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED', reason: '변심' },
    });
  });

  it('L2. aborted in_progress -> committed claim: stale in_progress never escapes', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ);
    occ.updateOutsideTransaction(ORDER_PATH, {
      cancellation: {
        status: 'REFUNDING',
        reason: 'foreign',
        refundClaim: { token: 'foreign-token', expiresAt: Date.now() + 300000 },
        updatedAt: new Date().toISOString(),
      },
    });
    const { service, payments, settlements } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // Attempt 1 observed the active foreign claim (in_progress).
          // Expire it before validation so attempt 1 aborts and the retry
          // must stage the owned claim.
          occ.updateOutsideTransaction(ORDER_PATH, {
            cancellation: {
              status: 'REFUNDING',
              reason: 'foreign',
              refundClaim: { token: 'foreign-token', expiresAt: Date.now() - 1000 },
              updatedAt: new Date().toISOString(),
            },
          });
        }
        arm();
      });
    };
    arm();

    await expect(
      service.cancelOrder('store-1', ORDER_ID, 'consumer-1', '변심'),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });
    occ.clearHooks();

    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0].writeCount).toBe(0);
    expect(commits[1].writeCount).toBe(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });

  it('L3. aborted claim -> committed foreign: aborted token never calls provider', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ);
    const { service, payments, settlements, notifications } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // Attempt 1 staged the owned claim (1 write). A foreign active
          // claim lands before validation, forcing an abort. The retry must
          // observe the foreign claim and stage nothing.
          occ.updateOutsideTransaction(ORDER_PATH, {
            cancellation: {
              status: 'REFUNDING',
              reason: 'foreign',
              refundClaim: { token: 'foreign-token', expiresAt: Date.now() + 300000 },
              updatedAt: new Date().toISOString(),
            },
          });
        }
        arm();
      });
    };
    arm();

    await expect(
      service.cancelOrder('store-1', ORDER_ID, 'consumer-1', '변심'),
    ).rejects.toBeInstanceOf(ConflictException);
    occ.clearHooks();

    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0].writeCount).toBe(1);
    expect(commits[1].writeCount).toBe(0);
    // The aborted owned claim must not reach the provider.
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'RECRUITING',
      cancellation: { status: 'REFUNDING', refundClaim: { token: 'foreign-token' } },
    });
    // Sequential retry still observes the foreign claim deterministically.
    await expect(
      service.cancelOrder('store-1', ORDER_ID, 'consumer-1', '변심'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
  });

  it('L1b. sequential done idempotency keeps provider 0 without orphan claim', async () => {
    const occ = createOccFirestore();
    seedDone(occ);
    const { service, payments, settlements } = makeService(occ);

    await expect(
      service.cancelOrder('store-1', ORDER_ID, 'consumer-1', '변심'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });
});
