// 회차 직배송 완료 사진의 "배송 회차" 규칙. 사진은 연결된 배송 회차(보류 사이 구간)에서만 완료 근거가 된다.
//
// 완료 사진 업로드는 사진을 먼저 연결하고(deliveryPhotoIds) 그다음 DELIVERING → DELIVERED로 전이한다.
// 드물게 연결만 되고 전이가 빠진 주문이 보류되면, 예전 사진이 남아 재배송 뒤 상세의 완료 PATCH가
// 그 사진으로 완료하거나 새 사진 업로드가 "이미 다른 사진이 연결됨"으로 막혔다.
// 그래서 완료되지 않은 주문이 보류될 때 연결 사진을 감사 필드(detachedDeliveryPhotos)로 옮기고,
// 연결 때 그 순간의 보류 표시(deliveryHold.heldAt)를 함께 남겨 완료 게이트가 같은 회차인지 본다.
// Storage 객체와 보관 기록(deliveryPhotoRecords)은 건드리지 않는다. 보관 기간 파기는 보관 기록이
// 주문 필드와 무관하게 맡는다.

type OrderRecord = Record<string, unknown>;

/** 연결 해제 사유. 지금은 보류 전이만 연결을 푼다. */
export type DetachedDeliveryPhotoReason = 'HOLD';

export interface DetachedDeliveryPhoto {
  photoId: string;
  detachedAt: string;
  reason: DetachedDeliveryPhotoReason;
}

export function readDeliveryPhotoIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((photoId): photoId is string => typeof photoId === 'string')
    : [];
}

function readDetachedDeliveryPhotos(value: unknown): DetachedDeliveryPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is DetachedDeliveryPhoto =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as OrderRecord)['photoId'] === 'string',
  );
}

/** 주문의 현재 보류 표시(deliveryHold.heldAt). 보류 이력이 없으면 null. */
export function readCurrentHeldAt(order: OrderRecord): string | null {
  const heldAt = (order['deliveryHold'] as OrderRecord | null | undefined)?.['heldAt'];
  return typeof heldAt === 'string' && heldAt.trim().length > 0 ? heldAt : null;
}

/** 보류 전이로 연결이 풀린 사진인지. 예전 앱이 보류 전 사진을 다시 보내면 거절하는 데 쓴다. */
export function isDetachedDeliveryPhoto(order: OrderRecord, photoId: string): boolean {
  return readDetachedDeliveryPhotos(order['detachedDeliveryPhotos']).some(
    (entry) => entry.photoId === photoId,
  );
}

/** 사진 연결 때 함께 쓰는 필드. 연결 순간의 보류 표시를 남겨 완료 게이트가 같은 배송 회차인지 본다. */
export function deliveryPhotoAttachFields(order: OrderRecord): OrderRecord {
  return { deliveryPhotoAttachedHoldAt: readCurrentHeldAt(order) };
}

/**
 * 이번 배송 회차에 연결된 사진이 있는지. 연결 때 남긴 보류 표시가 지금 보류 표시와 같아야 한다
 * (시각 비교 없이 같은 값인지만 본다). 이 필드가 없는 예전 연결은 보류 이력이 없을 때만 인정한다.
 * 보류 이력이 있는데 연결 시점을 알 수 없으면 보류 전 사진일 수 있어 인정하지 않는다(fail closed).
 */
export function hasCurrentCycleDeliveryPhoto(order: OrderRecord): boolean {
  if (readDeliveryPhotoIds(order['deliveryPhotoIds']).length === 0) return false;
  const attachedHoldAt = order['deliveryPhotoAttachedHoldAt'];
  const recordedHoldAt =
    typeof attachedHoldAt === 'string' && attachedHoldAt.trim().length > 0 ? attachedHoldAt : null;
  return recordedHoldAt === readCurrentHeldAt(order);
}

/**
 * 완료되지 않은 주문이 DELIVERY_HELD로 갈 때 연결 사진을 감사 필드로 옮기는 갱신.
 * 같은 트랜잭션에서 읽은 최신 주문으로 만들어 보류 전이 갱신에 합친다. 옮길 사진이 없으면 빈 객체.
 */
export function detachDeliveryPhotosOnHold(
  order: OrderRecord,
  nextStatus: unknown,
  detachedAt: string,
): OrderRecord {
  if (nextStatus !== 'DELIVERY_HELD' || order['status'] === 'DELIVERED') return {};
  const photoIds = readDeliveryPhotoIds(order['deliveryPhotoIds']);
  if (photoIds.length === 0) return {};
  return {
    deliveryPhotoIds: [],
    detachedDeliveryPhotos: [
      ...readDetachedDeliveryPhotos(order['detachedDeliveryPhotos']),
      ...photoIds.map(
        (photoId): DetachedDeliveryPhoto => ({ photoId, detachedAt, reason: 'HOLD' }),
      ),
    ],
  };
}
