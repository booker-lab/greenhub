import type { RedeliveryPaymentActionability, RedeliveryPaymentState } from '@greenhub/shared';

export interface RedeliveryPaymentPresentation {
  label: string;
  description: string;
  color: string;
}

const RECOVERY_STATES: RedeliveryPaymentState[] = ['FAILED', 'REFUNDED', 'MISMATCHED'];

/**
 * 배송 시작·재개 버튼의 표시 권한을 서버가 반환한 결제 의미로만 판단한다.
 * 실제 상태 변경 권한은 항상 API Core gate가 최종 판단한다.
 */
export function isDeliveryStartAllowed(
  payment: RedeliveryPaymentActionability | null | undefined,
): boolean {
  if (!payment) return false;
  if (payment.required === false) return true;
  return payment.required === true && payment.paid === true && payment.requiresRecovery === false;
}

export function getRedeliveryPaymentPresentation(
  payment: RedeliveryPaymentActionability | null | undefined,
): RedeliveryPaymentPresentation | null {
  if (!payment?.required) return null;

  if (payment.requiresRecovery || RECOVERY_STATES.includes(payment.status)) {
    return {
      label: '운영 확인 필요',
      description: '재배송비 결제 상태를 운영팀에서 확인해야 합니다.',
      color: 'red',
    };
  }

  if (payment.status === 'PAID' && payment.paid) {
    return {
      label: '재배송비 결제 완료',
      description: '서버에서 결제 완료 상태를 확인했습니다. 배송을 시작할 수 있습니다.',
      color: 'green',
    };
  }

  if (payment.status === 'MISSING') {
    return {
      label: '재배송비 결제 정보 확인 필요',
      description: '결제 정보를 확인할 때까지 배송을 시작할 수 없습니다.',
      color: 'orange',
    };
  }

  if (payment.status === 'PENDING') {
    return {
      label: '재배송비 결제 대기',
      description: '결제가 완료될 때까지 배송을 시작할 수 없습니다.',
      color: 'orange',
    };
  }

  return {
    label: '운영 확인 필요',
    description: '재배송비 결제 상태를 확인해야 합니다.',
    color: 'red',
  };
}
