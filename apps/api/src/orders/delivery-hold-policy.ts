import { BadRequestException } from '@nestjs/common';

type DeliveryHoldPolicyInput = Record<string, unknown>;

export function assertDeliveryHoldPolicy(hold: DeliveryHoldPolicyInput): void {
  if (hold['reasonCode'] !== 'WEATHER') return;

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
