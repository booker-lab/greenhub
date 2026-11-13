import { BadRequestException } from '@nestjs/common';

type DeliveryHoldPolicyInput = Record<string, unknown>;

export function assertDeliveryHoldPolicy(hold: DeliveryHoldPolicyInput): void {
  if (hold['reasonCode'] === 'PRODUCT_DAMAGED') {
    assertProductDamagedHold(hold);
    return;
  }
  if (hold['reasonCode'] === 'RECEIPT_REFUSED' && hold['customerResponsible'] !== true) {
    throw new BadRequestException('수령 거부 보류는 고객 책임으로만 처리할 수 있습니다.');
  }
  if (hold['reasonCode'] !== 'WEATHER') {
    assertResponsibilityMatchesFee(hold);
    return;
  }

  if (hold['customerResponsible'] !== false) {
    throw new BadRequestException('기상 보류는 고객 책임으로 처리할 수 없습니다.');
  }
  if (hold['redeliveryFee'] !== null) {
    throw new BadRequestException('기상 보류에는 재배송비를 부과할 수 없습니다.');
  }

  const nextDeliveryAt = hold['nextDeliveryAt'];
  if (
    typeof nextDeliveryAt !== 'string' ||
    nextDeliveryAt.trim().length === 0 ||
    Number.isNaN(new Date(nextDeliveryAt).getTime())
  ) {
    throw new BadRequestException('기상 보류에는 유효한 새 배송 일정이 필요합니다.');
  }
}

/**
 * 상품 파손 보류를 남길 수 있는 요청인지 확인한다. 파손은 배송 중인 기사가 직접 확인한 사실이므로
 * 기사가 배송 중(DELIVERING)일 때만 받는다. 판매자·관리자·수거 전(PREPARING) 보류는 거절한다.
 * 상태는 진입 시점 값이지만, 이후 쓰기 트랜잭션이 같은 상태인지 다시 확인한다.
 */
export function assertDeliveryHoldOrigin(
  reasonCode: unknown,
  currentStatus: string,
  requesterRole: string,
): void {
  if (reasonCode !== 'PRODUCT_DAMAGED') return;
  if (requesterRole !== 'driver') {
    throw new BadRequestException('상품 파손 보류는 배송 기사만 남길 수 있습니다.');
  }
  if (currentStatus !== 'DELIVERING') {
    throw new BadRequestException('상품 파손 보류는 배송 중인 주문에서만 남길 수 있습니다.');
  }
}

// 상품 파손은 판매자·기사 책임이고 다시 배송하지 않는다(주문 취소·전액 환불로만 끝난다).
// 고객 책임·재배송비가 붙으면 유료 재배송 결제가 열리므로 받지 않는다. 새 배송 일정은 요구하지 않는다.
function assertProductDamagedHold(hold: DeliveryHoldPolicyInput): void {
  if (hold['customerResponsible'] !== false) {
    throw new BadRequestException('상품 파손 보류는 고객 책임으로 처리할 수 없습니다.');
  }
  if (hold['redeliveryFee'] !== null && hold['redeliveryFee'] !== undefined) {
    throw new BadRequestException('상품 파손 보류에는 재배송비를 부과할 수 없습니다.');
  }
  // 다시 배송하지 않으므로 새 배송 예정이 있으면 소비자 화면에 "다음 배송" 줄이 잘못 보인다.
  if (hold['nextDeliveryAt'] !== null && hold['nextDeliveryAt'] !== undefined) {
    throw new BadRequestException('상품 파손 보류에는 새 배송 예정을 둘 수 없습니다.');
  }
}

// 기상 외 보류는 고객 책임 ⇔ 0원보다 큰 재배송비다. 유료 재배송 결제(redelivery-resume-gate)는
// 둘이 함께일 때만 열리므로, 어긋나면 결제 요청 없이 고객 책임만 남거나 책임 없는 고객에게 비용이 붙는다.
function assertResponsibilityMatchesFee(hold: DeliveryHoldPolicyInput): void {
  const customerResponsible = hold['customerResponsible'] === true;
  const fee = hold['redeliveryFee'];
  const hasFee = typeof fee === 'number' && Number.isFinite(fee) && fee > 0;
  if (customerResponsible && !hasFee) {
    throw new BadRequestException('고객 책임 보류에는 0원보다 큰 재배송비가 필요합니다.');
  }
  if (!customerResponsible && hasFee) {
    throw new BadRequestException('고객 책임이 아닌 보류에는 재배송비를 받을 수 없습니다.');
  }
}
