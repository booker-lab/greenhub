// Admin legacy refund OCC retry-purity closure proofs on the canonical harness.
// Task: ADMIN-LEGACY-REFUND-OCC-RETRY-PURITY-CLOSURE-02
//
// Proves ABORTED_TRANSACTION_ATTEMPT_STATE_MUST_NOT_ESCAPE for
// AdminService.forceLegacyRefund via claimLegacyRefund's committed-return
// decision transport (FirestoreService.runTransaction<T> return propagation):
//   A.  normal claim commits; provider exactly once; local converges
//   B1. aborted done -> committed claim (stale done must not escape)
//   B2. aborted in_progress -> committed claim (stale in_progress must not escape)
//   C.  aborted claim -> committed foreign (aborted claim must not call provider)
//   D.  overlapping claimers converge; provider exactly once; loser has no side effect
//   E.  retry exhaustion has provider/local side effect 0 and no staged claim
//   F.  already-done idempotency keeps provider 0 and existing semantics
//   G.  foreign active claim keeps provider 0 and preserves foreign state
//   H1. provider failure releases own claim to REFUND_FAILED only
//   H2. provider-failure release never removes a newer/foreign claim
//
// Uses only the canonical harness at ../../test/helpers/firestore-occ-fake
// (per-doc versions, conflict detection, bounded retry, staged-write discard,
// beforeCommit deterministic interleaving). No serial fakes, no timers.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { AdminService } from './admin.service';

type Occ = ReturnType<typeof createOccFirestore>;

const ORDER_ID = 'order-1';
const ORDER_PATH = `orders/${ORDER_ID}`;
const CAP_PATH = 'dailyCaps/store-1_2026-08-25';

function makeService(occ: Occ) {
  const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const roundLifecycle = { cancelForRound: jest.fn() };
  const service = new AdminService(
    occ.firestore as never,
    payments as never,
    settlements as never,
    roundLifecycle as never,
  );
  return { service, payments, settlements, roundLifecycle };
}

function seedClaimable(occ: Occ, overrides: Record<string, unknown> = {}) {
  occ.seed(ORDER_PATH, {
    id: ORDER_ID,
    storeId: 'store-1',
    status: 'ACCEPTED',
    schemaVersion: 1,
    saleType: 'normal',
    deliveryMethod: 'direct',
    quantity: 1,
    requestedDeliveryDate: '2026-08-25',
    ...overrides,
  });
  occ.seed(CAP_PATH, { totalCap: 10, usedSlots: 1 });
}

function seedDone(occ: Occ) {
  occ.seed(ORDER_PATH, {
    id: ORDER_ID,
    storeId: 'store-1',
    status: 'CANCELLED',
    schemaVersion: 1,
    saleType: 'normal',
    deliveryMethod: 'direct',
    quantity: 1,
    requestedDeliveryDate: '2026-08-25',
    cancellation: {
      status: 'COMPLETED',
      reason: '관리자 강제 환불',
      completedAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    },
    legacyDailyCapacity: {
      status: 'RELEASED',
      date: '2026-08-25',
      quantity: 1,
    },
  });
  occ.seed(CAP_PATH, { totalCap: 10, usedSlots: 0 });
}

describe('Admin legacy refund OCC retry purity', () => {
  it('A. normal claim commits: provider once, local converges, metadata preserved', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ);
    const { service, payments, settlements } = makeService(occ);

    const commits: Array<{ readPaths: string[]; writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ readPaths: [...ctx.readPaths], writeCount: ctx.writes.length });
        arm();
      });
    };
    arm();

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).resolves.toEqual({
      ok: true,
      orderId: ORDER_ID,
    });
    occ.clearHooks();

    // Claim transaction (1 write) + local-cancellation transaction.
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ readPaths: [ORDER_PATH], writeCount: 1 });
    expect(commits[1].writeCount).toBeGreaterThanOrEqual(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledWith(ORDER_ID, '관리자 강제 환불');
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledWith(ORDER_ID);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      id: ORDER_ID,
      storeId: 'store-1',
      status: 'CANCELLED',
      quantity: 1,
      cancellation: { status: 'COMPLETED', reason: '관리자 강제 환불' },
    });
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 0 });
  });

  it('B1. aborted done -> committed claim: stale done never escapes, provider runs once', async () => {
    const occ = createOccFirestore();
    seedDone(occ);
    // Claim attempt 1 will observe DONE; the retry must observe a claimable
    // order, so the local-cancellation capacity doc is seeded up front.
    occ.seed(CAP_PATH, { totalCap: 10, usedSlots: 1 });
    const { service, payments, settlements } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // Attempt 1 read DONE; make the live order claimable before its
          // commit validation so attempt 1 aborts and the retry must claim.
          occ.updateOutsideTransaction(ORDER_PATH, {
            status: 'ACCEPTED',
            cancellation: null,
          });
        }
        arm();
      });
    };
    arm();

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).resolves.toEqual({
      ok: true,
      orderId: ORDER_ID,
    });
    occ.clearHooks();

    // Attempt 1 (done, 0 writes, aborted) + attempt 2 (claim, 1 write,
    // committed) + local-cancellation commit.
    expect(commits).toHaveLength(3);
    expect(commits[0].writeCount).toBe(0);
    expect(commits[1].writeCount).toBe(1);
    // Old outer-mutation code returned stale done here: provider 0 with a
    // leaked REFUNDING claim left behind. Committed-return must claim.
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    // The DONE seed already carried RELEASED capacity, so the retry's local
    // cancellation must not double-release it (ALREADY_RELEASED path).
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 1 });
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      legacyDailyCapacity: { status: 'RELEASED', quantity: 1 },
    });
  });

  it('B2. aborted in_progress -> committed claim: stale in_progress never escapes', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ, {
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
          // Attempt 1 observed the active foreign claim; expire it before
          // validation so attempt 1 aborts and the retry must claim.
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

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).resolves.toEqual({
      ok: true,
      orderId: ORDER_ID,
    });
    occ.clearHooks();

    expect(commits).toHaveLength(3);
    expect(commits[0].writeCount).toBe(0);
    expect(commits[1].writeCount).toBe(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });

  it('C. aborted claim -> committed foreign: aborted claim never calls provider', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ);
    const { service, payments, settlements } = makeService(occ);

    const commits: Array<{ writeCount: number }> = [];
    const arm = (): void => {
      occ.setBeforeCommit((ctx) => {
        commits.push({ writeCount: ctx.writes.length });
        if (commits.length === 1) {
          // Attempt 1 staged the own claim; a foreign active claim lands
          // before its commit validation, forcing an abort. The retry must
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

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).rejects.toThrow(
      '주문 환불이 이미 처리 중입니다.',
    );
    occ.clearHooks();

    expect(commits).toHaveLength(2);
    expect(commits[0].writeCount).toBe(1);
    expect(commits[1].writeCount).toBe(0);
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'ACCEPTED',
      cancellation: { status: 'REFUNDING', refundClaim: { token: 'foreign-token' } },
    });
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 1 });
  });

  it('D. overlapping claimers converge: provider exactly once, loser has no side effect', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ);
    const { service, payments, settlements } = makeService(occ);

    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const providerReleasePromise = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    payments.processRefundByOrderId.mockImplementationOnce(async () => {
      providerStarted();
      await providerReleasePromise;
    });

    const first = service.forceRefund(ORDER_ID, '관리자 강제 환불');
    await providerStartedPromise;

    // The winner holds REFUNDING while blocked in the provider; the loser
    // must observe in_progress and never reach the provider itself.
    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).rejects.toThrow(
      '주문 환불이 이미 처리 중입니다.',
    );
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'ACCEPTED',
      cancellation: { status: 'REFUNDING' },
    });
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 1 });

    releaseProvider();
    await expect(first).resolves.toEqual({ ok: true, orderId: ORDER_ID });
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 0 });
  });

  it('E. retry exhaustion fails bounded with provider/local side effect 0', async () => {
    const occ = createOccFirestore({ maxAttempts: 2 });
    seedClaimable(occ);
    const { service, payments, settlements } = makeService(occ);

    let bumps = 0;
    const rearm = (): void => {
      occ.setBeforeCommit(() => {
        bumps += 1;
        // Neutral version bump: forces conflict without itself claiming.
        occ.updateOutsideTransaction(ORDER_PATH, { probe: bumps });
        rearm();
      });
    };
    rearm();

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).rejects.toThrow(
      'transaction retry limit exceeded',
    );
    occ.clearHooks();

    expect(bumps).toBe(2);
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
    // Only the external probe writes landed; staged claims were discarded.
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'ACCEPTED', probe: 2 });
    expect((occ.getData(ORDER_PATH) as Record<string, unknown>)['cancellation']).toBeUndefined();
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 1 });
  });

  it('F. already-done idempotency keeps provider 0 and existing semantics', async () => {
    const occ = createOccFirestore();
    seedDone(occ);
    const { service, payments, settlements } = makeService(occ);

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).resolves.toEqual({
      ok: true,
      orderId: ORDER_ID,
    });
    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).resolves.toEqual({
      ok: true,
      orderId: ORDER_ID,
    });

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).toHaveBeenCalledTimes(2);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 0 });
  });

  it('G. foreign active claim keeps provider 0 and preserves foreign state', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ, {
      cancellation: {
        status: 'REFUNDING',
        reason: 'foreign',
        refundClaim: { token: 'foreign-token', expiresAt: Date.now() + 300000 },
        updatedAt: new Date().toISOString(),
      },
    });
    const { service, payments, settlements } = makeService(occ);

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).rejects.toThrow(
      '주문 환불이 이미 처리 중입니다.',
    );
    // Second attempt observes the same foreign claim deterministically.
    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).rejects.toThrow(
      '주문 환불이 이미 처리 중입니다.',
    );

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'ACCEPTED',
      cancellation: { status: 'REFUNDING', refundClaim: { token: 'foreign-token' } },
    });
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 1 });
  });

  it('H1. provider failure releases own claim to REFUND_FAILED only', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ);
    const { service, payments, settlements } = makeService(occ);
    payments.processRefundByOrderId.mockRejectedValueOnce(new Error('provider down'));

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).rejects.toThrow(
      'provider down',
    );

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'ACCEPTED',
      cancellation: { status: 'REFUND_FAILED', reason: '관리자 강제 환불' },
    });
    expect(
      (occ.getData(ORDER_PATH)?.['cancellation'] as Record<string, unknown>)['refundClaim'],
    ).toBeUndefined();
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 1 });
  });

  it('H2. provider-failure release never removes a newer/foreign claim', async () => {
    const occ = createOccFirestore();
    seedClaimable(occ);
    const { service, payments, settlements } = makeService(occ);
    payments.processRefundByOrderId.mockRejectedValueOnce(new Error('provider down'));

    const commits: string[] = [];
    const arm = (): void => {
      occ.setBeforeCommit(() => {
        commits.push('commit');
        if (commits.length === 2) {
          // Release attempt 0 has read the own claim; a newer foreign claim
          // lands before its commit validation, forcing a retry that must
          // observe the foreign claim and stage nothing.
          occ.updateOutsideTransaction(ORDER_PATH, {
            cancellation: {
              status: 'REFUNDING',
              reason: 'newer-foreign',
              refundClaim: { token: 'newer-foreign', expiresAt: Date.now() + 300000 },
              updatedAt: new Date().toISOString(),
            },
          });
        }
        arm();
      });
    };
    arm();

    await expect(service.forceRefund(ORDER_ID, '관리자 강제 환불')).rejects.toThrow(
      'provider down',
    );
    occ.clearHooks();

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
    // Claim + release attempt (aborted) + release retry (empty commit).
    expect(commits).toHaveLength(3);
    expect(occ.getData(ORDER_PATH)?.['cancellation']).toEqual({
      status: 'REFUNDING',
      reason: 'newer-foreign',
      refundClaim: { token: 'newer-foreign', expiresAt: expect.any(Number) },
      updatedAt: expect.any(String),
    });
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'ACCEPTED' });
    expect(occ.getData(CAP_PATH)).toMatchObject({ usedSlots: 1 });
  });
});
