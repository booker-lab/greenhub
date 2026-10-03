/**
 * 기사 지도 탭의 외부 지도 링크 생성 순수 함수.
 *
 * 주문 문서에는 배송지 좌표(lat/lng)를 기록하는 경로가 없어(좌표는 hub에만 존재)
 * 좌표 기반 길안내만으로는 목적지가 (0,0)이 된다. 그래서
 * - 유효한 좌표가 있을 때만 카카오맵 길찾기 웹 링크(`/link/to/이름,위도,경도`)를 쓰고
 * - 그 외에는 주소 문자열로 카카오맵 검색 웹 링크(`/link/search/검색어`)를 연다.
 * 0·누락·비유한·범위 밖 좌표는 절대 링크에 넣지 않는다.
 *
 * 웹 링크(https://map.kakao.com/link/...)는 앱 미설치 기기에서도 브라우저로 열린다.
 * 규격: https://apis.map.kakao.com/web/guide/ (URL 바로가기)
 */

export const KAKAO_MAP_LINK_BASE = 'https://map.kakao.com/link';

export type MapLinkOrder = {
  deliveryMethod?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
  lat?: unknown;
  lng?: unknown;
};

export type MapLink = {
  kind: 'route' | 'search';
  href: string;
};

/** 공백을 하나로 접고 앞뒤를 자른다. 문자열이 아니면 빈 문자열. */
function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * 경로 세그먼트에 들어갈 텍스트를 정리한다.
 * `/`는 인코딩해도 경로 구분자로 해석될 수 있어 공백으로 바꾼다.
 */
function toPathText(value: unknown): string {
  return normalizeText(normalizeText(value).replace(/\//g, ' '));
}

/** 0이 아니고 유한하며 WGS84 범위 안의 좌표만 허용한다. */
export function toValidCoordinate(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 || lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** 배송 방식에 따른 목적지 주소 문자열. hub 배송은 거점 주소를 쓴다. */
export function destinationAddress(order: MapLinkOrder): string {
  return toPathText(order.deliveryMethod === 'hub' ? order.hubAddress : order.address);
}

/** 주소 문자열 기반 카카오맵 검색 웹 링크. 빈 주소면 null. */
export function buildKakaoMapSearchUrl(query: unknown): string | null {
  const text = toPathText(query);
  if (!text) return null;
  return `${KAKAO_MAP_LINK_BASE}/search/${encodeURIComponent(text)}`;
}

/**
 * 좌표 기반 카카오맵 길찾기 웹 링크. 유효 좌표가 아니면 null.
 * 이름은 `이름,위도,경도` 구분자와 겹치지 않도록 쉼표를 공백으로 바꾼다.
 */
export function buildKakaoMapRouteUrl(name: unknown, lat: unknown, lng: unknown): string | null {
  const coordinate = toValidCoordinate(lat, lng);
  if (!coordinate) return null;
  const label = toPathText(normalizeText(name).replace(/,/g, ' ')) || '배송지';
  return `${KAKAO_MAP_LINK_BASE}/to/${encodeURIComponent(label)},${coordinate.lat},${coordinate.lng}`;
}

/**
 * 주문 1건의 외부 지도 링크.
 * 유효 좌표가 있으면 길찾기, 없으면 주소 검색, 둘 다 없으면 null(링크 미노출).
 * 소비자 이름은 외부 지도 URL에 넣지 않는다(목적지 라벨은 주소·거점명만 사용).
 */
export function buildOrderMapLink(order: MapLinkOrder): MapLink | null {
  const address = destinationAddress(order);
  const name = order.deliveryMethod === 'hub' ? normalizeText(order.hubName) || address : address;
  const route = buildKakaoMapRouteUrl(name, order.lat, order.lng);
  if (route) return { kind: 'route', href: route };
  const search = buildKakaoMapSearchUrl(address);
  if (search) return { kind: 'search', href: search };
  return null;
}
