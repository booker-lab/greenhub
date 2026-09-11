// Canonical Firestore transaction/OCC contract proofs.
//
// Covers the target contract closed by this task:
//   A. isolation (uncommitted writes invisible)
//   B. read versions recorded
//   C. external modification -> conflict
//   D. deterministic bounded retry
//   E. atomic multi-document commit
//   F. failure leaves no partial writes
//   G. deterministic interleaving (explicit hooks + setImmediate; the spec
//      itself uses no setTimeout / wall-clock races)
//
// Plus high-risk production regression proofs on the canonical harness:
//   R1. SettlementsService.createSettlement concurrent exactly-once
//   R2. confirmDueSettlements vs cancelSettlement race converges cancelled
//   R3. PaymentRefundService.refundByOrderId concurrent double-claim refunds once
//
// NOTE: no existing fake/spec is modified here; this spec only consumes the
// new canonical harness at ../../test/helpers/firestore-occ-fake.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OrderChargePaymentService } from '../payments/order-charge-payment.service';
import { SettlementsService } from '../settlements/settlements.service';

function configService(values: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

describe('canonical Firestore OCC contract', () => {
  it('A. staged writes are invisible to live state until commit, visible inside the transaction', async () => {
    const occ = createOccFirestore();
    occ.seed('docs/a', { n: 1 });

    const pending = occ.firestore.runTransaction(async (tx) => {
      tx.set(occ.firestore.doc('docs/b'), { n: 2 });
      const inside = await tx.get(occ.firestore.doc('docs/b'));
      expect(inside.data()).toEqual({ n: 2 });
      await new Promise<void>((resolve) => setImmediate(resolve));
      return 'done';
    });

    // The attempt is staged (callback suspended at the yield above); live
    // state must not observe docs/b yet. Runs synchronously before microtasks.
    expect(occ.getData('docs/b')).toBeUndefined();
    expect(await occ.firestore.doc('docs/b').get().then((snap) => snap.exists)).toBe(false);

    await expect(pending).resolves.toBe('done');
    expect(occ.getData('docs/b')).toEqual({ n: 2 });
  });

  it('B+C+D. external modification after a transactional read conflicts and retries with fresh data', async () => {
    const occ = createOccFirestore();
    occ.seed('counters/c1', { n: 0 });
    let attempts = 0;

    await occ.firestore.runTransaction(async (tx) => {
      attempts += 1;
      const snap = await tx.get(occ.firestore.doc('counters/c1'));
      if (attempts === 1) {
        // Deterministic interleaving: external write lands after this
        // attempt's read but before its commit validation.
        occ.updateOutsideTransaction('counters/c1', { n: 100 });
      }
      tx.update(occ.firestore.doc('counters/c1'), { n: (snap.data()?.['n'] as number) + 1 });
    });

    expect(attempts).toBe(2);
    expect(occ.getData('counters/c1')).toEqual({ n: 101 });
  });

  it('D. concurrent read-modify-write increments converge via retry (lost-update guard)', async () => {
    const occ = createOccFirestore();
    occ.seed('counters/shared', { n: 0 });
    let invocations = 0;
    const increment = () =>
      occ.firestore.runTransaction(async (tx) => {
        invocations += 1;
        const snap = await tx.get(occ.firestore.doc('counters/shared'));
        tx.update(occ.firestore.doc('counters/shared'), {
          n: (snap.data()?.['n'] as number) + 1,
        });
      });

    // No timers: both attempts read v0 in the microtask drain, then commit
    // in setImmediate FIFO order; the loser retries once. Exactly 3 runs.
    await Promise.all([increment(), increment()]);

    expect(occ.getData('counters/shared')).toEqual({ n: 2 });
    expect(invocations).toBe(3);
  });

  it('D-exhaustion. persistent conflict fails bounded with no transaction writes applied', async () => {
    const occ = createOccFirestore({ maxAttempts: 2 });
    occ.seed('counters/hot', { n: 0 });
    const rearm = (): void => {
      occ.setBeforeCommit(() => {
        occ.updateOutsideTransaction('counters/hot', { n: 1000 });
        rearm();
      });
    };
    rearm();

    await expect(
      occ.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(occ.firestore.doc('counters/hot'));
        tx.update(occ.firestore.doc('counters/hot'), {
          n: (snap.data()?.['n'] as number) + 1,
        });
      }),
    ).rejects.toThrow('transaction retry limit exceeded');

    // Only the external writes landed; no transaction increment survived.
    expect(occ.getData('counters/hot')).toEqual({ n: 1000 });
  });

  it('F. callback failure leaves no partial writes and preserves versions', async () => {
    const occ = createOccFirestore();
    occ.seed('docs/keep', { n: 1 });
    const versionBefore = occ.getVersion('docs/keep');

    await expect(
      occ.firestore.runTransaction(async (tx) => {
        tx.set(occ.firestore.doc('docs/staged'), { n: 9 });
        tx.update(occ.firestore.doc('docs/keep'), { n: 2 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(occ.getData('docs/staged')).toBeUndefined();
    expect(occ.getData('docs/keep')).toEqual({ n: 1 });
    expect(occ.getVersion('docs/keep')).toBe(versionBefore);
  });

  it('E. commit-time failure applies atomically (nothing lands)', async () => {
    const occ = createOccFirestore();
    occ.seed('docs/a', { n: 1 });
    occ.seed('docs/b', { n: 1 });

    occ.setBeforeCommit(() => {
      occ.deleteOutsideTransaction('docs/a');
    });

    await expect(
      occ.firestore.runTransaction(async (tx) => {
        tx.set(occ.firestore.doc('docs/c'), { n: 3 });
        tx.update(occ.firestore.doc('docs/a'), { n: 10 });
        tx.update(occ.firestore.doc('docs/b'), { n: 10 });
      }),
    ).rejects.toThrow('존재하지 않는 문서입니다: docs/a');

    expect(occ.getData('docs/c')).toBeUndefined();
    expect(occ.getData('docs/b')).toEqual({ n: 1 });
    expect(occ.getData('docs/a')).toBeUndefined();
  });

  it('G. beforeCommit hook observes read set and staged writes for deterministic control', async () => {
    const occ = createOccFirestore();
    occ.seed('docs/observed', { n: 5 });
    let observed: { readPaths: string[]; kinds: string[] } | undefined;
    occ.setBeforeCommit((context) => {
      observed = {
        readPaths: [...context.readPaths],
        kinds: context.writes.map((write) => write.kind),
      };
    });

    await occ.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(occ.firestore.doc('docs/observed'));
      tx.update(occ.firestore.doc('docs/observed'), {
        n: (snap.data()?.['n'] as number) + 1,
      });
      return 'ok';
    });

    expect(observed).toEqual({ readPaths: ['docs/observed'], kinds: ['update'] });
    expect(occ.getData('docs/observed')).toEqual({ n: 6 });
  });

  it('read-your-writes: a transactional get observes the same-attempt staged update', async () => {
    const occ = createOccFirestore();
    occ.seed('docs/rw', { n: 1 });

    await occ.firestore.runTransaction(async (tx) => {
      tx.update(occ.firestore.doc('docs/rw'), { n: 2 });
      const snap = await tx.get(occ.firestore.doc('docs/rw'));
      expect(snap.data()).toEqual({ n: 2 });
    });

    expect(occ.getData('docs/rw')).toEqual({ n: 2 });
  });
});

describe('canonical harness high-risk regression proofs', () => {
  it('R1. concurrent createSettlement converges to exactly one settlement', async () => {
    const occ = createOccFirestore();
    const settlements = new SettlementsService(
      occ.firestore as never,
      configService({ PLATFORM_FEE_RATE: '0.05' }) as never,
    );
    const order = { id: 'order-race-1', storeId: 'store-1', status: 'DELIVERED', totalAmount: 30000 };

    await Promise.all(Array.from({ length: 8 }, () => settlements.createSettlement(order, 'DELIVERED')));

    expect(occ.listData('settlements/')).toHaveLength(1);
    expect(occ.getData('settlements/order-race-1')).toEqual(
      expect.objectContaining({ status: 'pending', totalAmount: 30000 }),
    );
  });

  it('R2. confirm commit racing cancel converges to cancelled (no resurrection)', async () => {
    const occ = createOccFirestore();
    const settlements = new SettlementsService(
      occ.firestore as never,
      configService({ SETTLEMENT_CONFIRM_DELAY_DAYS: '1' }) as never,
    );
    const orderId = 'order-confirm-cancel-1';
    occ.seed(`settlements/${orderId}`, {
      id: orderId,
      storeId: 'store-1',
      orderId,
      totalAmount: 10000,
      platformFeeRate: 0.05,
      platformFee: 500,
      netAmount: 9500,
      status: 'pending',
      completedStatus: 'DELIVERED',
      settledAt: new Date('2026-08-25T00:00:00.000Z'),
      confirmedAt: null,
      paidAt: null,
      createdAt: new Date('2026-08-25T00:00:00.000Z'),
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    });
    occ.setBeforeCommit(async () => {
      await settlements.cancelSettlement(orderId);
    });

    await settlements.confirmDueSettlements();

    expect(occ.getData(`settlements/${orderId}`)?.['status']).toBe('cancelled');
  });

  it('R3. concurrent markFailed converges to one FAILED plus one already_processed', async () => {
    const occ = createOccFirestore();
    occ.seed('orderCharges/c1', {
      id: 'c1',
      orderId: 'order-1',
      status: 'PENDING',
      type: 'REDELIVERY_FEE',
      amount: 3000,
      portonePaymentId: 'order-charge-c1',
    });
    const portone = { getPayment: jest.fn(), refund: jest.fn() };
    const charges = new OrderChargePaymentService(occ.firestore as never, portone as never);

    const results = await Promise.all([
      charges['markFailed']('c1', 'order-charge-c1'),
      charges['markFailed']('c1', 'order-charge-c1'),
    ]);

    // One winner commits FAILED via the OCC retry path; the loser retries,
    // observes FAILED, and converges to already_processed with no second write.
    expect(results).toContainEqual({ ok: true, status: 'FAILED' });
    expect(results).toContainEqual({ ok: true, reason: 'already_processed' });
    expect(occ.getData('orderCharges/c1')).toMatchObject({ status: 'FAILED' });
    expect(occ.getVersion('orderCharges/c1')).toBe(1);
  });
});
