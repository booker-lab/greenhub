/**
 * 주문 상세 배송 보류 안내의 고객 문구(C-28, 2026-11-07 사용자 확정).
 *
 * 판매자·기사가 직접 적은 보류 사유(`reasonMessage`)는 내부 표현이 섞일 수 있어 안내 본문으로 쓰지 않는다.
 * 본문은 알림톡(`DELIVERY_HOLD_CUSTOMER_REASONS`)처럼 사유 코드별 고정 문구로 정하고,
 * 직접 적은 내용은 화면에서 "담당자 메모"로 구분해 따로 보인다.
 *
 * 정책(`apps/api/src/orders/delivery-hold-policy.ts`): 기상은 고객 책임·재배송비가 없다.
 * 그 밖에는 고객 책임이면 0원보다 큰 재배송비가 있고, 아니면 없다. 재배송비를 결제해야 재배송이 시작된다.
 * 수령 거부는 늘 고객 책임(재배송비 결제)이다. 상품 파손은 다시 배송하지 않고 가게가 주문을 취소·환불하므로
 * 재배송비 안내를 붙이지 않는다.
 */

import type { DeliveryHoldReasonCode } from '@greenhub/shared';

export type { DeliveryHoldReasonCode };

export interface DeliveryHoldNoticeInput {
  reasonCode: DeliveryHoldReasonCode;
  customerResponsible: boolean;
  redeliveryFee: number | null;
  /** 재배송비 결제가 끝났으면 '결제하면 다시 배송해요' 문장을 빼고 결제 완료 안내에 맡긴다. */
  redeliveryPaid: boolean;
}

export interface DeliveryHoldNotice {
  title: string;
  lines: string[];
}

const REASON_COPY: Record<
  Exclude<DeliveryHoldReasonCode, 'OTHER' | 'PRODUCT_DAMAGED'>,
  { title: string; sentence: string }
> = {
  WEATHER: {
    title: '날씨 때문에 배송을 미뤘어요',
    sentence: '안전한 배송이 어려워 배송을 미뤘어요.',
  },
  ACCESS_UNAVAILABLE: {
    title: '출입이 어려워 배송하지 못했어요',
    sentence: '공동현관·출입 방법을 확인하지 못해 배송하지 못했어요.',
  },
  ADDRESS_ISSUE: {
    title: '주소를 찾지 못해 배송하지 못했어요',
    sentence: '적어 주신 주소로 배송지를 찾지 못했어요.',
  },
  CUSTOMER_UNREACHABLE: {
    title: '연락이 닿지 않아 배송하지 못했어요',
    sentence: '받는 분과 연락이 닿지 않아 배송하지 못했어요.',
  },
  RECEIPT_REFUSED: {
    title: '수령을 거부하셔서 배송하지 못했어요',
    sentence: '받는 분이 상품 수령을 거부하셔서 배송하지 못했어요.',
  },
};

// 상품 파손은 다시 배송하지 않는다. 재배송비 안내 대신 가게가 취소·환불한다는 것만 알린다.
const PRODUCT_DAMAGED_NOTICE: DeliveryHoldNotice = {
  title: '상품이 파손돼 배송하지 못했어요',
  lines: ['배송 중 상품이 파손돼 배송하지 못했어요. 가게에서 주문 취소·환불을 진행해요.'],
};

const OTHER_CUSTOMER_COPY = {
  title: '배송하지 못했어요',
  sentence: '배송을 진행하지 못했어요.',
};
const OTHER_STORE_COPY = {
  title: '배송을 잠시 미뤘어요',
  sentence: '저희 사정으로 배송이 늦어지고 있어요.',
};

export const REDELIVERY_FREE_LINE = '재배송비는 없어요.';
// 재배송비를 아직 결제하지 않았을 때 결제 버튼 아래에 보인다. 주문 상세 하단에 고객센터가 있다.
export const REDELIVERY_UNPAID_NOTICE =
  '재배송비를 결제하지 않으면 배송이 다시 시작되지 않아요. 결제가 어렵다면 아래 고객센터로 문의해 주세요.';

function hasFee(fee: number | null): fee is number {
  return typeof fee === 'number' && Number.isFinite(fee) && fee > 0;
}

export function redeliveryFeeLine(fee: number): string {
  return `재배송비 ${fee.toLocaleString('ko-KR')}원을 결제하면 다시 배송해요.`;
}

export function deliveryHoldNotice(input: DeliveryHoldNoticeInput): DeliveryHoldNotice {
  if (input.reasonCode === 'PRODUCT_DAMAGED') {
    return { title: PRODUCT_DAMAGED_NOTICE.title, lines: [...PRODUCT_DAMAGED_NOTICE.lines] };
  }
  const feeDue = input.customerResponsible && hasFee(input.redeliveryFee);
  const copy =
    input.reasonCode === 'OTHER'
      ? feeDue
        ? OTHER_CUSTOMER_COPY
        : OTHER_STORE_COPY
      : REASON_COPY[input.reasonCode];
  const lines = [copy.sentence];
  if (!feeDue) {
    lines.push(REDELIVERY_FREE_LINE);
  } else if (!input.redeliveryPaid) {
    lines.push(redeliveryFeeLine(input.redeliveryFee as number));
  }
  return { title: copy.title, lines };
}
