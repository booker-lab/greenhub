/**
 * 결제 화면 배송지 주소의 직접 입력 대체 수단(빠진 기능 1순위, 2026-11-07 사용자 승인).
 *
 * 주소 칸은 다음 우편번호 검색으로만 채울 수 있었다. 외부 스크립트(t1.daumcdn.net)가 막히거나
 * 늦게 뜨면 "주소 검색"을 눌러도 아무 일이 없어, 저장된 배송지가 없는 고객은 결제할 수 없었다.
 * 검색을 쓸 수 없을 때와 고객이 직접 고를 때 주소를 손으로 적게 한다.
 *
 * 우편번호는 직접 입력에서 모르면 비워 둘 수 있다. 서버 주문 계약(`DeliveryAddressDto`)은
 * 문자열(10자 이하)만 요구하고, 배송은 주소로 한다. 검색으로 채운 주소는 늘 우편번호가 함께 온다.
 */

export const ADDRESS_MAX_LENGTH = 200;
export const ZIP_CODE_MAX_LENGTH = 5;

export const ADDRESS_SEARCH_UNAVAILABLE_MESSAGE =
  '주소 검색을 열지 못했어요. 아래에 주소를 직접 적어 주세요.';
export const MANUAL_ADDRESS_PLACEHOLDER = '예: 경기도 이천시 중리천로 100';

interface AddressLike {
  address: string;
  zipCode: string;
}

/** 결제에 쓸 배송지 주소가 있는지. 우편번호는 직접 입력에서 비어 있을 수 있어 보지 않는다. */
export function hasDeliveryAddress(address: AddressLike): boolean {
  return address.address.trim().length > 0;
}

const ICHEON_PREFIXES = ['경기도 이천시', '경기 이천시', '이천시'];

/**
 * 직접 입력 중인 주소가 아직 이천 주소의 앞부분인지("경기도 이" 등).
 * 다 적기 전에 "이천시 주소만" 오류가 깜빡이지 않게 한다. 결제 버튼은 완성된 이천 주소에서만 켜진다.
 */
export function isIcheonAddressPrefix(value: string): boolean {
  const typed = value.replace(/\s+/g, ' ').trim();
  if (!typed) return true;
  return ICHEON_PREFIXES.some((prefix) => prefix.startsWith(typed));
}

/** 직접 입력한 주소: 앞뒤 공백을 지우고 연속 공백을 하나로 줄이며 서버 상한에 맞춘다. */
export function normalizeManualAddress(value: string): string {
  return value.replace(/\s+/g, ' ').trimStart().slice(0, ADDRESS_MAX_LENGTH);
}

/** 직접 입력한 우편번호: 숫자만 남기고 5자리(도로명 우편번호)까지만 받는다. */
export function normalizeManualZipCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, ZIP_CODE_MAX_LENGTH);
}

type PostcodeConstructor = new (options: {
  oncomplete: (data: { address: string; zonecode: string }) => void;
}) => { open: () => void };

/** 다음 우편번호 스크립트가 쓸 수 있게 불러와졌는지. 없거나 형태가 다르면 null이다. */
export function readPostcodeConstructor(scope: unknown): PostcodeConstructor | null {
  if (!scope || typeof scope !== 'object') return null;
  const daum = (scope as { daum?: unknown }).daum;
  if (!daum || typeof daum !== 'object') return null;
  const Postcode = (daum as { Postcode?: unknown }).Postcode;
  return typeof Postcode === 'function' ? (Postcode as PostcodeConstructor) : null;
}
