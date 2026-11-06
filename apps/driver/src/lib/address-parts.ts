// 기사 화면의 주소 나누기. 주문의 address는 기본 주소(deliveryAddress.address)에 상세 주소(동·호수)를 붙인 값이다
// (API driver-order-read-model: address = deliveryAddress.address + addressDetail). 문 앞에서는 동·호수가 가장 중요하므로
// 화면은 상세 주소를 크게, 기본 주소를 작게 쓴다. 두 값이 맞지 않으면 나누지 않는다(지어내지 않는다).
export type AddressParts = { base: string; detail: string | null };

export function splitDeliveryAddress(
  full: string | null | undefined,
  base: string | null | undefined,
): AddressParts | null {
  const whole = full?.trim();
  if (!whole) return null;
  const head = base?.trim();
  if (!head || head === whole || !whole.startsWith(head)) return { base: whole, detail: null };
  const detail = whole.slice(head.length).trim();
  return detail ? { base: head, detail } : { base: whole, detail: null };
}
