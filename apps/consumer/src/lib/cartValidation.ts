import { type CartItem, isRoundCartItem } from '@/hooks/useCart';

export type CartValidationIssueCode = 'missing-store' | 'missing-delivery-date';

export interface CartValidationIssue {
  code: CartValidationIssueCode;
  itemMessage: string;
  checkoutMessage: string;
}

const MISSING_STORE_ISSUE: CartValidationIssue = {
  code: 'missing-store',
  itemMessage: '상점 정보가 없어 다시 선택해야 결제할 수 있어요.',
  checkoutMessage: '상점 정보가 없는 상품이 있어 결제할 수 없습니다. 장바구니를 다시 담아 주세요.',
};

const MISSING_DELIVERY_DATE_ISSUE: CartValidationIssue = {
  code: 'missing-delivery-date',
  itemMessage: '배송일을 다시 선택해야 결제할 수 있어요.',
  checkoutMessage: '배송 날짜가 없는 상품이 있어 결제할 수 없습니다. 장바구니를 다시 담아 주세요.',
};

export function getCartItemValidationIssues(item: CartItem): CartValidationIssue[] {
  if (isRoundCartItem(item)) return [];

  const issues: CartValidationIssue[] = [];

  if (!item.storeId) {
    issues.push(MISSING_STORE_ISSUE);
  }

  if (
    item.saleType !== 'group' &&
    item.deliveryMethod !== 'parcel' &&
    !item.requestedDeliveryDate
  ) {
    issues.push(MISSING_DELIVERY_DATE_ISSUE);
  }

  return issues;
}

export function getCartValidationError(items: CartItem[]): string | null {
  for (const item of items) {
    const issue = getCartItemValidationIssues(item)[0];
    if (issue) return issue.checkoutMessage;
  }

  return null;
}

export function hasCartValidationIssues(items: CartItem[]): boolean {
  return getCartValidationError(items) !== null;
}
