// 수거 장소 표시. 기사 주문 응답(목록·상세)은 수거 대기(PREPARING) 주문에만 가게 이름·주소
// (`pickupStoreName`·`pickupAddress`, 가게 문서 name·address)를 싣는다. 값이 없거나 비면 줄을 숨긴다(지어내지 않는다).
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

export function readPickupPlace(order: {
  status?: unknown;
  pickupStoreName?: unknown;
  pickupAddress?: unknown;
}): PickupPlace | null {
  if (order.status !== 'PREPARING') return null;
  const storeName = cleanText(order.pickupStoreName);
  const address = cleanText(order.pickupAddress);
  if (!storeName && !address) return null;
  return {
    storeName,
    address,
    label: `수거: ${[storeName, address].filter(Boolean).join(' · ')}`,
    mapHref: address ? buildKakaoMapSearchUrl(address) : null,
  };
}
