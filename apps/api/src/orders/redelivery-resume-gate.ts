import { ConflictException } from '@nestjs/common';
import type { RedeliveryPaymentActionability, RedeliveryPaymentState } from '@greenhub/shared';

type OrderRecord = Record<string, any>;

const CHARGE_STATUSES = new Set<RedeliveryPaymentState>([
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
]);

export function isCurrentRedeliveryPaymentRequired(order: OrderRecord): boolean {
  const hold = order['deliveryHold'] as OrderRecord | null | undefined;
  if (!hold || hold['customerResponsible'] !== true) return false;

  const fee = hold['redeliveryFee'];
  return typeof fee === 'number' && Number.isFinite(fee) && fee > 0 && isUnresolved(hold['resolvedAt']);
}

export function isCurrentRedeliveryChargeLinked(
  order: OrderRecord,
  charge: OrderRecord,
  chargeId: string,
): boolean {
  const holdAt = currentHoldAt(order);
  return (
    typeof order['redeliveryChargeId'] === 'string' &&
    order['redeliveryChargeId'] === chargeId &&
    order['redeliveryChargeHoldAt'] === holdAt &&
    isChargeForCurrentHold(order, charge, chargeId)
  );
}

export function isChargeForCurrentHold(
  order: OrderRecord,
  charge: OrderRecord,
  chargeId: string,
): boolean {
  const hold = order['deliveryHold'] as OrderRecord | null | undefined;
  const holdAt = currentHoldAt(order);
  const fee = hold?.['redeliveryFee'];
  return (
    isCurrentRedeliveryPaymentRequired(order) &&
    typeof holdAt === 'string' &&
    charge['id'] === chargeId &&
    charge['orderId'] === order['id'] &&
    charge['storeId'] === order['storeId'] &&
    charge['userId'] === order['userId'] &&
    charge['type'] === 'REDELIVERY_FEE' &&
    charge['customerResponsible'] === true &&
    charge['holdAt'] === holdAt &&
    charge['amount'] === fee &&
    typeof charge['portonePaymentId'] === 'string' &&
    charge['portonePaymentId'].length > 0
  );
}

export async function assertPaidRedeliveryResume(input: {
  tx: any;
  firestore: { doc(path: string): any };
  order: OrderRecord;
  orderId: string;
}) {
  if (!isCurrentRedeliveryPaymentRequired(input.order)) return null;

  const holdAt = currentHoldAt(input.order);
  const chargeId = input.order['redeliveryChargeId'];
  if (
    !holdAt ||
    typeof chargeId !== 'string' ||
    input.order['redeliveryChargeHoldAt'] !== holdAt
  ) {
    throw new ConflictException('현재 유료 재배송의 결제 연결을 확인할 수 없습니다.');
  }

  const chargeSnap = await input.tx.get(input.firestore.doc(`orderCharges/${chargeId}`));
  if (!chargeSnap.exists) {
    throw new ConflictException('현재 유료 재배송 결제를 찾을 수 없습니다.');
  }
  const charge = chargeSnap.data() as OrderRecord;
  if (!isCurrentRedeliveryChargeLinked({ ...input.order, id: input.orderId }, charge, chargeId)) {
    throw new ConflictException('현재 유료 재배송과 연결된 결제가 아닙니다.');
  }
  if (charge['status'] !== 'PAID') {
    throw new ConflictException('유료 재배송 결제가 완료되지 않았습니다.');
  }
  return charge;
}

export function resolveRedeliveryPaymentActionability(input: {
  order: OrderRecord;
  chargeExists: boolean;
  charge?: OrderRecord;
}): RedeliveryPaymentActionability {
  const { order, chargeExists, charge } = input;
  const holdAt = currentHoldAt(order);
  const chargeId = typeof order['redeliveryChargeId'] === 'string' ? order['redeliveryChargeId'] : null;
  const base = { holdAt, chargeId, required: true };

  if (!isCurrentRedeliveryPaymentRequired(order)) {
    return {
      required: false,
      holdAt: null,
      chargeId: null,
      status: 'NOT_REQUIRED',
      canPay: false,
      paid: false,
      requiresRecovery: false,
    };
  }

  if (!holdAt) {
    return { ...base, status: 'MISMATCHED', canPay: false, paid: false, requiresRecovery: true };
  }
  if (!chargeId) {
    if (order['redeliveryChargeHoldAt'] !== null && order['redeliveryChargeHoldAt'] !== undefined) {
      return { ...base, status: 'MISMATCHED', canPay: false, paid: false, requiresRecovery: true };
    }
    const canPay = order['status'] === 'DELIVERY_HELD' || order['status'] === 'PREPARING';
    return { ...base, status: 'MISSING', canPay, paid: false, requiresRecovery: !canPay };
  }
  if (order['redeliveryChargeHoldAt'] !== holdAt) {
    return { ...base, status: 'MISMATCHED', canPay: false, paid: false, requiresRecovery: true };
  }
  if (!chargeExists || !charge) {
    return { ...base, status: 'MISSING', canPay: false, paid: false, requiresRecovery: true };
  }
  if (!isCurrentRedeliveryChargeLinked({ ...order, id: order['id'] }, charge, chargeId)) {
    return { ...base, status: 'MISMATCHED', canPay: false, paid: false, requiresRecovery: true };
  }

  const status = CHARGE_STATUSES.has(charge['status'])
    ? (charge['status'] as RedeliveryPaymentState)
    : 'MISMATCHED';
  return {
    ...base,
    status,
    canPay: status === 'PENDING',
    paid: status === 'PAID',
    requiresRecovery: status === 'FAILED' || status === 'REFUNDED' || status === 'MISMATCHED',
  };
}

function currentHoldAt(order: OrderRecord): string | null {
  const heldAt = (order['deliveryHold'] as OrderRecord | null | undefined)?.['heldAt'];
  return typeof heldAt === 'string' && heldAt.trim().length > 0 ? heldAt : null;
}

function isUnresolved(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 || Number.isNaN(new Date(trimmed).getTime());
  }
  if (value instanceof Date) return false;
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') return false;
  return true;
}
