import type {
  SaleRound,
  SaleRoundCancellation,
  SaleRoundSchedule,
  SaleRoundStatus,
} from '@greenhub/shared';
import { ConflictException } from '@nestjs/common';

export type SaleRoundRecord = SaleRound & Record<string, any>;

export interface SaleRoundCancellationClaim {
  ownerId: string;
  leaseId: string;
}

export const SALE_ROUND_CANCELLATION_LEASE_MS = 5 * 60 * 1000;

export function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof (value as { toMillis?: () => number })?.toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date })?.toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === 'string') return new Date(value).getTime();
  return Number.NaN;
}

export function timestampIso(value: unknown): string {
  const millis = timestampMillis(value);
  if (!Number.isFinite(millis)) throw new ConflictException('회차 시각이 올바르지 않습니다.');
  return new Date(millis).toISOString();
}

export function assertScheduleOrder(schedule: SaleRoundSchedule | Record<string, any>) {
  const orderOpenAt = timestampMillis(schedule.orderOpenAt);
  const orderCloseAt = timestampMillis(schedule.orderCloseAt);
  const auctionAt = timestampMillis(schedule.auctionAt);
  const deliveryStartAt = timestampMillis(schedule.deliveryStartAt);
  const deliveryEndAt = timestampMillis(schedule.deliveryEndAt);
  if (
    !(
      Number.isFinite(orderOpenAt) &&
      Number.isFinite(orderCloseAt) &&
      Number.isFinite(auctionAt) &&
      Number.isFinite(deliveryStartAt) &&
      Number.isFinite(deliveryEndAt)
    ) ||
    !(orderOpenAt < orderCloseAt && orderCloseAt <= auctionAt && auctionAt <= deliveryStartAt) ||
    !(deliveryStartAt < deliveryEndAt)
  ) {
    throw new ConflictException('회차 일정 순서가 올바르지 않습니다.');
  }
}

export function assertOrderWindowOpen(round: SaleRoundRecord, nowMillis: number) {
  if (round.status !== 'OPEN') {
    throw new ConflictException('현재 주문 가능한 회차가 아닙니다.');
  }
  if (round.cancellation != null) {
    throw new ConflictException('취소 처리 중인 회차에는 주문할 수 없습니다.');
  }
  const openAt = timestampMillis(round.schedule?.orderOpenAt);
  const closeAt = timestampMillis(round.schedule?.orderCloseAt);
  if (
    !Number.isFinite(nowMillis) ||
    !Number.isFinite(openAt) ||
    !Number.isFinite(closeAt) ||
    openAt >= closeAt
  ) {
    throw new ConflictException('회차 주문 시간이 올바르지 않습니다.');
  }
  if (nowMillis < openAt) {
    throw new ConflictException('주문 시작 전인 회차입니다.');
  }
  if (nowMillis >= closeAt) {
    throw new ConflictException('주문 마감된 회차입니다.');
  }
}

export function assertManualOpenEligible(round: SaleRoundRecord, nowMillis: number) {
  if (round.status !== 'SCHEDULED') {
    throw new ConflictException('예정 상태의 회차만 수동으로 개방할 수 있습니다.');
  }
  if (round.cancellation != null) {
    throw new ConflictException('취소 처리 중인 회차는 개방할 수 없습니다.');
  }
  assertScheduleOrder(round.schedule);
  if (!Number.isFinite(nowMillis)) {
    throw new ConflictException('회차 개방 시각을 확인할 수 없습니다.');
  }
  const openAt = timestampMillis(round.schedule.orderOpenAt);
  const closeAt = timestampMillis(round.schedule.orderCloseAt);
  if (nowMillis < openAt) {
    throw new ConflictException('주문 시작 전에는 회차를 개방할 수 없습니다.');
  }
  if (nowMillis >= closeAt) {
    throw new ConflictException('주문 마감 후에는 회차를 개방할 수 없습니다.');
  }
}

export function resolveAutomaticState(
  round: SaleRoundRecord,
  nowMillis: number,
): {
  status: SaleRoundStatus;
  closeReason: SaleRound['closeReason'];
} {
  if (round.cancellation != null) {
    return { status: round.status, closeReason: round.closeReason ?? null };
  }
  const closeAt = timestampMillis(round.schedule?.orderCloseAt);
  const openAt = timestampMillis(round.schedule?.orderOpenAt);
  if (!Number.isFinite(closeAt) || !Number.isFinite(openAt) || openAt >= closeAt) {
    return { status: round.status, closeReason: round.closeReason ?? null };
  }
  if (round.status === 'CLOSED' && round.closeReason === 'CAPACITY') {
    if (nowMillis < closeAt && !isCapacityFull(round)) {
      return { status: 'OPEN', closeReason: null };
    }
    return { status: 'CLOSED', closeReason: 'CAPACITY' };
  }
  if (!['SCHEDULED', 'OPEN'].includes(round.status)) {
    return { status: round.status, closeReason: round.closeReason ?? null };
  }
  if (nowMillis >= closeAt) return { status: 'CLOSED', closeReason: 'SCHEDULE_ENDED' };
  if (isCapacityFull(round)) return { status: 'CLOSED', closeReason: 'CAPACITY' };
  if (round.status === 'SCHEDULED' && nowMillis >= openAt) {
    return { status: 'OPEN', closeReason: null };
  }
  return { status: round.status, closeReason: round.closeReason ?? null };
}

export function isCapacityFull(round: SaleRoundRecord) {
  const counters = round.counters ?? {};
  const limits = round.limits ?? {};
  const addressCount =
    (counters.reservedDeliveryAddresses ?? 0) + (counters.orderedDeliveryAddresses ?? 0);
  const itemCount = (counters.reservedItemQuantity ?? 0) + (counters.orderedItemQuantity ?? 0);
  return (
    addressCount >= (limits.maxDeliveryAddresses ?? Number.POSITIVE_INFINITY) ||
    itemCount >= (limits.maxItemQuantity ?? Number.POSITIVE_INFINITY)
  );
}

export function isRoundOrderCancellationPending(order: Record<string, any>) {
  if (['DELIVERED', 'REVIEWED'].includes(order.status)) return false;
  if (order.status === 'CANCELLED') {
    return order.cancellation?.status != null && order.cancellation.status !== 'COMPLETED';
  }
  return true;
}

export function assertStatusTransition(current: SaleRoundStatus, next: SaleRoundStatus) {
  const transitions: Record<SaleRoundStatus, SaleRoundStatus[]> = {
    DRAFT: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['OPEN', 'CANCELLED'],
    OPEN: ['CLOSED', 'CANCELLED'],
    CLOSED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  };
  if (!transitions[current]?.includes(next)) {
    throw new ConflictException(`${current} → ${next} 회차 상태 전환은 허용되지 않습니다.`);
  }
}

export function cancellationLeaseExpiryMillis(cancellation: Partial<SaleRoundCancellation> | null) {
  if (!cancellation) return Number.NaN;
  const explicitExpiry = timestampMillis(cancellation.leaseExpiresAt);
  if (Number.isFinite(explicitExpiry)) return explicitExpiry;
  const updatedAt = timestampMillis(cancellation.updatedAt);
  return Number.isFinite(updatedAt) ? updatedAt + SALE_ROUND_CANCELLATION_LEASE_MS : Number.NaN;
}

export function isCancellationClaimCurrent(
  round: SaleRoundRecord,
  claim: SaleRoundCancellationClaim,
  nowMillis: number,
) {
  const cancellation = round.cancellation;
  return (
    cancellation?.status === 'CANCELLING' &&
    cancellation.ownerId === claim.ownerId &&
    cancellation.leaseId === claim.leaseId &&
    cancellationLeaseExpiryMillis(cancellation) > nowMillis
  );
}

export function assertCancellationClaim(
  round: SaleRoundRecord,
  claim: SaleRoundCancellationClaim,
  nowMillis: number,
) {
  if (!isCancellationClaimCurrent(round, claim, nowMillis)) {
    throw new ConflictException('회차 취소 작업의 소유권이 만료되었거나 변경되었습니다.');
  }
}
