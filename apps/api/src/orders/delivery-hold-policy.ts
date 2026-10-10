import { BadRequestException } from '@nestjs/common';

type DeliveryHoldPolicyInput = Record<string, unknown>;

export function assertDeliveryHoldPolicy(hold: DeliveryHoldPolicyInput): void {
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
