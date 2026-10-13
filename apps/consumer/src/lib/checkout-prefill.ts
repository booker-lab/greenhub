import type { SavedAddress } from '@greenhub/shared';

// 회차 결제 화면 자동 채움. 이미 저장된 계정 정보(기본 배송지·전화번호)만 쓰고,
// 사용자가 먼저 입력한 값은 덮지 않는다. 이천시 여부는 결제 폼이 그대로 검사한다.

export interface CheckoutAddressDraft {
  address: string;
  addressDetail: string;
  zipCode: string;
}

export interface CheckoutPrefill {
  address: CheckoutAddressDraft | null;
  phone: string | null;
}

function isUsableAddress(value: unknown): value is SavedAddress {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.address === 'string' &&
    record.address.trim().length > 0 &&
    typeof record.zipCode === 'string' &&
    record.zipCode.trim().length > 0
  );
}

/** GET /auth/me 응답에서 기본 배송지(없으면 첫 배송지)와 전화번호를 고른다. */
export function pickCheckoutPrefill(profile: unknown): CheckoutPrefill {
  if (typeof profile !== 'object' || profile === null) return { address: null, phone: null };
  const record = profile as Record<string, unknown>;
  const saved = Array.isArray(record.savedAddresses)
    ? record.savedAddresses.filter(isUsableAddress)
    : [];
  const chosen = saved.find((item) => item.isDefault === true) ?? saved[0] ?? null;
  const phone =
    typeof record.phone === 'string' && record.phone.trim().length > 0 ? record.phone.trim() : null;
  return {
    address: chosen
      ? {
          address: chosen.address.trim(),
          addressDetail: typeof chosen.addressDetail === 'string' ? chosen.addressDetail : '',
          zipCode: chosen.zipCode.trim(),
        }
      : null,
    phone,
  };
}

/** 배송지 칸이 모두 비어 있을 때만 저장된 배송지로 채운다. */
export function prefillAddress(
  current: CheckoutAddressDraft,
  prefill: CheckoutPrefill,
): CheckoutAddressDraft {
  const empty = !current.address && !current.zipCode && !current.addressDetail;
  return empty && prefill.address ? prefill.address : current;
}

/** 연락처가 비어 있을 때만 프로필 전화번호로 채운다. */
export function prefillPhone(current: string, prefill: CheckoutPrefill): string {
  return !current && prefill.phone ? prefill.phone : current;
}
