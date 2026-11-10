// 기사 화면의 상품 표기. 주문의 productName은 첫 상품 이름이고 quantity는 전체 수량 합계라
// (round-order-create: productName=roundItems[0], quantity=itemQuantityTotal),
// "외 N건"이나 "× N"은 상품 종류 수를 잘못 알려 준다. 기사가 챙길 개수인 "총 N개"로 보인다.
export function orderItemsLabel(
  productName: string | null | undefined,
  quantity: number | null | undefined,
) {
  const name = productName?.trim() || '-';
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 1) return name;
  return `${name} · 총 ${quantity}개`;
}

/** 기사 API(GET /driver/orders)가 싣는 주문 상품. 이름·수량만 있다. */
export type DriverOrderItem = { productName: string; quantity: number };

function isDriverOrderItem(value: unknown): value is DriverOrderItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { productName?: unknown; quantity?: unknown };
  return (
    typeof item.productName === 'string' &&
    item.productName.trim().length > 0 &&
    typeof item.quantity === 'number' &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0
  );
}

// 상품마다 한 줄("상품명 · N개")로 보여 기사가 상품별로 챙길 개수를 바로 알게 한다.
// 상품 목록이 없거나(이전 API 응답 등) 하나라도 형식이 어긋나면 null을 돌려주고,
// 화면은 기존 한 줄 표기(orderItemsLabel)로 대신한다.
export function orderItemLines(items: unknown): string[] | null {
  if (!Array.isArray(items) || items.length === 0 || !items.every(isDriverOrderItem)) {
    return null;
  }
  return items.map((item) => `${item.productName.trim()} · ${item.quantity}개`);
}

/**
 * 목록 행의 상품 요약 한 줄. 한 종이면 "상품 · N개", 여러 종이면 "첫 상품 외 N종 · 총 M개"로 줄여
 * 390px 폭에서도 수거 시각이 잘리지 않게 한다(상품별 개수는 상세·다음 배송지 카드에서 본다).
 * 상품 목록이 없거나 형식이 어긋나면 null이고, 화면은 기존 한 줄 표기(orderItemsLabel)로 대신한다.
 */
export function orderItemsSummary(items: unknown): string | null {
  const lines = orderItemLines(items);
  if (!lines) return null;
  const list = items as DriverOrderItem[];
  if (list.length === 1) return lines[0];
  const total = list.reduce((sum, item) => sum + item.quantity, 0);
  return `${list[0].productName.trim()} 외 ${list.length - 1}종 · 총 ${total}개`;
}
