import type { RedeliveryPaymentActionability, RedeliveryPaymentState } from '@greenhub/shared';
// vitest에서 `@/` 별칭 없이 읽히도록 상대 경로로 둔다.
import { DRIVER_OPS_CONTACT } from '../../../lib/ops-contact';

export interface RedeliveryPaymentPresentation {
  label: string;
  description: string;
  color: 'brand' | 'red' | 'yellow';
  /** 운영팀 확인이 필요한 상태면 true. 상세 화면이 운영팀 전화 링크를 둔다. */
  needsOps: boolean;
}

const RECOVERY_STATES: RedeliveryPaymentState[] = ['FAILED', 'REFUNDED', 'MISMATCHED'];

// 목록 한 행에도 그대로 보이므로 짧게 쓰고, 누구에게 연락할지 번호를 넣는다(D-18).
const OPS_CHECK_DESCRIPTION = `${DRIVER_OPS_CONTACT.label} ${DRIVER_OPS_CONTACT.phone}로 연락해 주세요.`;

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

/**
 * 재배송비 결제 상태 표시. 버튼 잠금은 isDeliveryStartAllowed가 정하고, 여기서는 기사가 읽을 말만 정한다.
 */
export function getRedeliveryPaymentPresentation(
  payment: RedeliveryPaymentActionability | null | undefined,
): RedeliveryPaymentPresentation | null {
  if (!payment?.required) return null;

  if (payment.requiresRecovery || RECOVERY_STATES.includes(payment.status)) {
    return {
      label: '운영 확인 필요',
      description: OPS_CHECK_DESCRIPTION,
      color: 'red',
      needsOps: true,
    };
  }

  if (payment.status === 'PAID' && payment.paid) {
    return {
      label: '재배송비 결제 완료',
      description: '결제됐어요. 배송을 다시 시작할 수 있어요.',
      color: 'brand',
      needsOps: false,
    };
  }

  // 결제 건이 아직 없지만 손님이 결제할 수 있는 정상 대기(D-03). 결제 요청 알림은 판매자가
  // "재배송 준비로 돌리기"를 눌러야 나가므로(mvp-sales-round-runbook.md §6.4) "손님 결제 대기"로 단정하지 않는다.
  if (
    payment.status === 'MISSING' &&
    payment.canPay === true &&
    payment.requiresRecovery === false
  ) {
    return {
      label: '재배송비 결제 전',
      description: '결제되면 다시 배송할 수 있어요.',
      color: 'yellow',
      needsOps: false,
    };
  }

  if (payment.status === 'MISSING') {
    return {
      label: '재배송비 결제 정보 확인 필요',
      description: '결제 정보를 확인할 때까지 배송을 시작할 수 없어요.',
      color: 'yellow',
      needsOps: false,
    };
  }

  if (payment.status === 'PENDING') {
    return {
      label: '재배송비 결제 대기',
      description: '결제가 완료될 때까지 배송을 시작할 수 없어요.',
      color: 'yellow',
      needsOps: false,
    };
  }

  return {
    label: '운영 확인 필요',
    description: OPS_CHECK_DESCRIPTION,
    color: 'red',
    needsOps: true,
  };
}
