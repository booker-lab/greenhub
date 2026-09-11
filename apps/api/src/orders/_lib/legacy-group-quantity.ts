// legacy-group-quantity.ts — legacy group currentQuantity restoration (GROUP-CONFIRMED-QUANTITY-RESTORATION-01)
//
// OrdersCreateService.createOrder increments groupProductConfig.currentQuantity at order
// creation. A legacy group order that terminates as CANCELLED must remove exactly its own
// quantity once, inside the same authoritative transaction that flips the order status.
// Consumer RECRUITING cancellation already does this; seller/admin CONFIRMED cancellations
// reuse this helper so all three legacy paths converge symmetrically.
//
// Non-owned counters are never touched here: round/schemaVersion:2 capacity,
// checkoutReservations, saleRounds/saleRoundItems counters, dailyCaps, settlement
// accounting, refund claim architecture and notification policy stay with their owners.
//
// Fail-closed policy (no silent clamp):
// - A damaged or already-released counter (non-finite, or smaller than the order
//   quantity) aborts the transaction with ConflictException. No Math.max(0) clamp is
//   used as a correctness mechanism and no generic reconciliation is attempted.
// - A missing groupProductConfig document or an order without usable contribution
//   metadata (quantity/productId) is tolerated as NOT_ELIGIBLE: cancellation still
//   succeeds instead of blocking seller/admin on anomalous legacy data. Such orders
//   cannot have contributed through the audited increment path, so there is nothing
//   to restore.

import { ConflictException } from '@nestjs/common';

type QuantitySnapshot = {
  exists: boolean;
  data(): Record<string, any> | undefined;
};

type QuantityTransaction = {
  get(ref: unknown): Promise<QuantitySnapshot>;
  update(ref: unknown, data: Record<string, unknown>): void;
};

type QuantityFirestoreLike = {
  doc(path: string): unknown;
  FieldValue: { increment(value: number): unknown };
};

export function isLegacyGroupQuantityEligible(order: Record<string, any>): boolean {
  return (
    order['saleType'] === 'group' &&
    order['schemaVersion'] !== 2 &&
    (order['roundId'] === undefined || order['roundId'] === null)
  );
}

/**
 * Restore one legacy group order contribution inside the caller's transaction.
 * Must be called in the same transaction that flips the order to CANCELLED so a
 * failed/aborted cancellation never leaves a counter-only partial state.
 */
export async function releaseLegacyGroupQuantityInTransaction(
  firestore: QuantityFirestoreLike,
  tx: QuantityTransaction,
  orderId: string,
  freshOrder: Record<string, any>,
): Promise<'RELEASED' | 'NOT_ELIGIBLE'> {
  void orderId;
  if (!isLegacyGroupQuantityEligible(freshOrder)) return 'NOT_ELIGIBLE';

  const quantity = freshOrder['quantity'];
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return 'NOT_ELIGIBLE';
  }
  const productId = freshOrder['productId'];
  if (typeof productId !== 'string' || productId.length === 0) {
    return 'NOT_ELIGIBLE';
  }

  const gcRef = firestore.doc(`groupProductConfig/${productId}`);
  const gcSnap = await tx.get(gcRef);
  if (!gcSnap.exists) return 'NOT_ELIGIBLE';

  const currentQuantity = gcSnap.data()?.['currentQuantity'];
  if (typeof currentQuantity !== 'number' || !Number.isFinite(currentQuantity)) {
    throw new ConflictException('공동구매 수량 상태가 올바르지 않아 취소할 수 없습니다.');
  }
  if (currentQuantity < quantity) {
    throw new ConflictException('공동구매 수량이 이미 반환되었거나 손상되었습니다.');
  }

  tx.update(gcRef, {
    currentQuantity: firestore.FieldValue.increment(-(quantity as number)),
  });
  return 'RELEASED';
}
