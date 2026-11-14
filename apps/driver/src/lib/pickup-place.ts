// 수거 장소 표시. 기사 주문 응답(목록·상세)은 수거 대기(PREPARING) 주문과 상품 파손 보류(가게로 반납) 주문에만
// 가게 이름·주소(`pickupStoreName`·`pickupAddress`, 가게 문서 name·address)를 싣는다. 값이 없거나 비면 줄을 숨긴다(지어내지 않는다).
// 지도 링크는 지도 탭과 같은 카카오맵 주소 검색 링크(map-navigation-link.ts)를 쓰고 가게 주소만 넣는다.
// vitest에서 `@/` 별칭 없이 읽히도록 상대 경로로 둔다.
import { buildKakaoMapSearchUrl } from '../app/map/_lib/map-navigation-link';

export type PickupPlace = {
  storeName: string | null;
  address: string | null;
  /** "수거: 가게 이름 · 주소". 한쪽만 있으면 있는 값만 쓴다. */
  label: string;
  /** 주소가 있을 때만 카카오맵 주소 검색 링크. */
  mapHref: string | null;
};

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

type StorePlaceFields = { pickupStoreName?: unknown; pickupAddress?: unknown };

function readStorePlace(order: StorePlaceFields, prefix: string): PickupPlace | null {
  const storeName = cleanText(order.pickupStoreName);
  const address = cleanText(order.pickupAddress);
  if (!storeName && !address) return null;
  return {
    storeName,
    address,
    label: `${prefix}: ${[storeName, address].filter(Boolean).join(' · ')}`,
    mapHref: address ? buildKakaoMapSearchUrl(address) : null,
  };
}

export function readPickupPlace(
  order: { status?: unknown } & StorePlaceFields,
): PickupPlace | null {
  if (order.status !== 'PREPARING') return null;
  return readStorePlace(order, '수거');
}

/** 상품 파손(PRODUCT_DAMAGED) 보류 주문인가. 상세는 deliveryHold.reasonCode, 목록은 deliveryHoldReasonCode로 온다. */
export function isDamagedHold(order: {
  status?: unknown;
  deliveryHold?: { reasonCode?: unknown } | null;
  deliveryHoldReasonCode?: unknown;
}): boolean {
  if (order.status !== 'DELIVERY_HELD') return false;
  const reasonCode = order.deliveryHold?.reasonCode ?? order.deliveryHoldReasonCode;
  return reasonCode === 'PRODUCT_DAMAGED';
}

/** 상품 파손 보류 주문의 반납 장소("반납: 가게 이름 · 주소"). 다른 주문이거나 값이 없으면 null(3차 재감사 S-11). */
export function readReturnPlace(
  order: Parameters<typeof isDamagedHold>[0] & StorePlaceFields,
): PickupPlace | null {
  if (!isDamagedHold(order)) return null;
  return readStorePlace(order, '반납');
}
