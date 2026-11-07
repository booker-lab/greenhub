/**
 * 회차 체크아웃 입력값(배송지·연락처·요청사항·포장 라벨)을 탭 저장소에 잠시 남긴다.
 *
 * 결제사 화면에서 뒤로 오거나 실패 화면의 "다시 결제하기"로 돌아오면 체크아웃이 새로 그려져
 * 고쳐 쓴 연락처·요청사항이 초기화됐다(C-05). 입력이 바뀔 때마다 저장하고 다시 열리면 복원한다.
 *
 * - 개인정보라 탭 범위인 sessionStorage에만 둔다(기기에 오래 남는 저장소는 쓰지 않는다).
 * - 같은 장바구니(회차·회차 상품)로 다시 열 때만 복원하고, 오래된 기록은 버린다.
 * - 기록에 저장한 계정을 남겨, 같은 탭에서 다른 계정으로 바뀌면 복원하지 않고 지운다.
 *   로그아웃·세션 만료가 탭 저장소를 비우지 않아도 다른 사람의 배송지·연락처가 보이지 않게 한다.
 * - 결제가 성공하면 지운다. 확인 체크는 결제 직전에 다시 확인해야 하므로 남기지 않는다.
 */

export const CHECKOUT_DRAFT_STORAGE_KEY = 'greenhub_checkout_draft';
// 계정을 남기기 전(버전 1) 기록은 누구 것인지 알 수 없어 복원하지 않는다.
const CHECKOUT_DRAFT_VERSION = 2;
// 결제창에서 오래 머문 경우까지 고려하되, 남은 기록이 한참 뒤 다른 결제에 쓰이지 않게 제한한다.
const CHECKOUT_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 1000;

export interface CheckoutDraft {
  address: { address: string; addressDetail: string; zipCode: string };
  deliveryPhone: string;
  requestNote: string;
  packageLabel: { enabled: boolean; text: string };
}

interface CheckoutDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

/** 같은 장바구니인지 가르는 값. 회차와 회차 상품 목록(순서 무관)으로 정한다. */
export function checkoutDraftCartKey(
  items: readonly { roundId: string; roundItemId: string }[],
): string {
  const roundId = items[0]?.roundId ?? '';
  const roundItemIds = items.map((item) => item.roundItemId).sort();
  return `${roundId}:${roundItemIds.join(',')}`;
}

function isEmptyDraft(draft: CheckoutDraft): boolean {
  return (
    !draft.address.address &&
    !draft.address.addressDetail &&
    !draft.address.zipCode &&
    !draft.deliveryPhone &&
    !draft.requestNote &&
    !draft.packageLabel.enabled &&
    !draft.packageLabel.text
  );
}

function readDraftFields(value: Record<string, unknown>): CheckoutDraft | null {
  const { address, deliveryPhone, requestNote, packageLabel } = value;
  if (
    !isRecord(address) ||
    !isText(address.address) ||
    !isText(address.addressDetail) ||
    !isText(address.zipCode) ||
    !isText(deliveryPhone) ||
    !isText(requestNote) ||
    !isRecord(packageLabel) ||
    typeof packageLabel.enabled !== 'boolean' ||
    !isText(packageLabel.text)
  ) {
    return null;
  }
  return {
    address: {
      address: address.address,
      addressDetail: address.addressDetail,
      zipCode: address.zipCode,
    },
    deliveryPhone,
    requestNote,
    packageLabel: { enabled: packageLabel.enabled, text: packageLabel.text },
  };
}

/** 저장된 기록을 읽는다. 손상·다른 계정·다른 장바구니·만료·미래 시각 기록은 null. */
export function readCheckoutDraft(
  raw: string | null,
  cartKey: string,
  ownerId: string,
  now: number,
): CheckoutDraft | null {
  if (!raw || !ownerId) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.version !== CHECKOUT_DRAFT_VERSION ||
    value.ownerId !== ownerId ||
    value.cartKey !== cartKey ||
    typeof value.savedAt !== 'number' ||
    !Number.isSafeInteger(value.savedAt) ||
    value.savedAt > now ||
    now - value.savedAt > CHECKOUT_DRAFT_TTL_MS
  ) {
    return null;
  }
  return readDraftFields(value);
}

/**
 * 입력값을 저장한다. 모두 비었거나 너무 길면 남기지 않는다. 저장소가 막혀도 결제는 진행한다.
 * 계정을 모르면(로그인 확인 전) 누구 것인지 남길 수 없어 저장하지 않는다.
 */
export function saveCheckoutDraft(
  storage: CheckoutDraftStorage | null,
  draft: CheckoutDraft,
  cartKey: string,
  ownerId: string,
  now: number,
): void {
  if (!storage || !ownerId) return;
  try {
    const checked = readDraftFields(draft as unknown as Record<string, unknown>);
    if (!checked || isEmptyDraft(checked)) {
      storage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);
      return;
    }
    storage.setItem(
      CHECKOUT_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: CHECKOUT_DRAFT_VERSION,
        ownerId,
        cartKey,
        savedAt: now,
        ...checked,
      }),
    );
  } catch {
    // 저장소가 막혀도 입력·결제는 그대로 진행한다. 복귀 뒤 복원만 생략된다.
  }
}

/**
 * 현재 계정·장바구니의 기록을 돌려준다. 쓸 수 없는 기록(다른 계정·다른 장바구니·만료·손상)은
 * 이 체크아웃이 어차피 덮어쓸 한 칸이므로 그 자리에서 지워, 다른 사람의 입력이 남지 않게 한다.
 * 계정을 모르면(로그인 확인 전) 읽지도 지우지도 않는다.
 */
export function loadCheckoutDraft(
  storage: CheckoutDraftStorage | null,
  cartKey: string,
  ownerId: string,
  now: number,
): CheckoutDraft | null {
  if (!storage || !ownerId) return null;
  try {
    const raw = storage.getItem(CHECKOUT_DRAFT_STORAGE_KEY);
    const draft = readCheckoutDraft(raw, cartKey, ownerId, now);
    if (!draft && raw !== null) storage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);
    return draft;
  } catch {
    return null;
  }
}

/** 결제가 성공하면 지운다. */
export function clearCheckoutDraft(storage: CheckoutDraftStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);
  } catch {
    // 저장소가 막혀도 결제 완료 처리는 막지 않는다.
  }
}

/** 브라우저 탭 저장소. 브라우저 밖이거나 접근이 막히면 null. */
export function readCheckoutDraftStorage(): CheckoutDraftStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
