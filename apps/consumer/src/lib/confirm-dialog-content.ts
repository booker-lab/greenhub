// 되돌릴 수 없는 소비자 동작(주문 취소·배송지 삭제) 확인창에 넣을 글자를 만드는 순수 함수.
// 순서와 모양은 design-direction §5 "위험 동작 확인창"을 따른다: 제목 = 동작 + 대상 → 대상 정보(이름–값) →
// 돈의 흐름(이름–값) → 되돌릴 수 없으면 빨간 한 줄 → 확정 버튼 문구.
// 읽을 수 없는 값은 줄을 빼고, 시스템 id·null·NaN 같은 글자는 만들지 않는다.

/** 확인창 이름–값 상자의 한 줄. */
export interface ConfirmRow {
  label: string;
  value: string;
}

export interface ConfirmDialogContent {
  /** 동작 + 대상("주문 20261112-000012 취소", "배송지 집 삭제"). */
  title: string;
  /** 대상 정보. */
  facts: ConfirmRow[];
  /** 돈의 흐름. */
  flow: ConfirmRow[];
  /** 되돌릴 수 없으면 확정 버튼 위의 빨간 한 줄. */
  warning: string | null;
  confirmLabel: string;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "대표 상품 외 n개". 이름이 없으면 null. */
export function summarizeProductNames(names: readonly unknown[]): string | null {
  const valid = names.map(clean).filter((name) => name.length > 0);
  if (valid.length === 0) return null;
  return valid.length === 1 ? valid[0] : `${valid[0]} 외 ${valid.length - 1}개`;
}

export interface OrderCancelConfirmInput {
  orderNumber: string;
  /** 회차 직배송 주문이면 true, 공동구매 참여(예전 판매)면 false. */
  isRoundOrder: boolean;
  /** 결제를 마치지 않은 주문(결제 확인 중)이면 true. 환불할 결제가 없다. */
  paymentPending: boolean;
  totalAmount: number;
  productNames: readonly unknown[];
}

export function orderCancelConfirmContent(input: OrderCancelConfirmInput): ConfirmDialogContent {
  if (!input.isRoundOrder) {
    // 공동구매 참여 취소는 같은 틀에 기존 문구를 그대로 쓴다.
    return {
      title: '공동구매 참여를 취소할까요?',
      facts: [],
      flow: [],
      warning: '취소하면 되돌릴 수 없어요.',
      confirmLabel: '참여 취소하기',
    };
  }

  const orderNumber = clean(input.orderNumber);
  const products = summarizeProductNames(input.productNames);
  const flow: ConfirmRow[] = [];
  if (input.paymentPending) {
    // 결제를 마치지 않은 주문은 환불을 약속하지 않는다.
    flow.push({ label: '결제', value: '결제 전 주문이에요' });
  } else if (Number.isSafeInteger(input.totalAmount) && input.totalAmount >= 0) {
    // 주문 상세 응답에는 결제 수단 이름이 없다. 어디로 돌아가는지만 "결제한 수단"으로 알린다.
    flow.push({
      label: '환불',
      value: `${input.totalAmount.toLocaleString('ko-KR')}원 · 결제한 수단`,
    });
  }
  return {
    title: orderNumber ? `주문 ${orderNumber} 취소` : '주문 취소',
    facts: products ? [{ label: '상품', value: products }] : [],
    flow,
    warning: '취소한 주문은 되살릴 수 없어요.',
    confirmLabel: '주문 취소하기',
  };
}

export interface AddressDeleteConfirmInput {
  label: unknown;
  address: unknown;
  addressDetail?: unknown;
}

export function addressDeleteConfirmContent(
  input: AddressDeleteConfirmInput,
): ConfirmDialogContent {
  const label = clean(input.label);
  const fullAddress = [clean(input.address), clean(input.addressDetail)]
    .filter((part) => part.length > 0)
    .join(' ');
  return {
    title: label ? `배송지 ${label} 삭제` : '배송지 삭제',
    // 주소는 줄이지 않고 전체를 넘긴다(창이 줄을 나눠 보인다).
    facts: fullAddress ? [{ label: '주소', value: fullAddress }] : [],
    flow: [],
    warning: null,
    confirmLabel: '삭제하기',
  };
}
