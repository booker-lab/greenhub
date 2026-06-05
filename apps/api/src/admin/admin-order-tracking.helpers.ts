import type { OrderStatus } from '@greenhub/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { UpdateOrderTrackingDto } from './dto/admin.dto';

const TRACKING_EDITABLE_STATUSES: OrderStatus[] = [
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
];

type FirestoreLike = {
  doc: (path: string) => any;
  Timestamp: {
    now: () => unknown;
  };
};

export async function updateAdminOrderTracking(
  firestore: FirestoreLike,
  orderId: string,
  dto: UpdateOrderTrackingDto,
  adminId: string,
) {
  const courierCompany = dto.courierCompany.trim();
  const trackingNumber = dto.trackingNumber.trim();
  if (!courierCompany || trackingNumber.length < 3) {
    throw new BadRequestException('택배사와 운송장번호를 입력해야 합니다.');
  }

  const ref = firestore.doc(`orders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

  const order = snap.data();
  if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
  if (order.deliveryMethod !== 'parcel') {
    throw new BadRequestException('택배 주문의 송장만 수정할 수 있습니다.');
  }

  const hasTracking = Boolean(order.courierCompany?.trim() && order.trackingNumber?.trim());
  const isAfterShipping = TRACKING_EDITABLE_STATUSES.includes(order.status as OrderStatus);
  if (!hasTracking && !isAfterShipping) {
    throw new BadRequestException(
      '아직 발송되지 않은 주문은 셀러 발송 플로우에서 송장을 입력해야 합니다.',
    );
  }

  const now = firestore.Timestamp.now();
  await ref.update({
    courierCompany,
    trackingNumber,
    trackingUpdatedAt: now,
    trackingUpdatedBy: adminId,
    updatedAt: now,
  });

  return { ok: true, orderId, courierCompany, trackingNumber };
}
