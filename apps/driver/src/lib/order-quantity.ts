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
