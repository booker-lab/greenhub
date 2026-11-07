import { readMaskedPayoutAccount } from '../app/settings/payout-account/_lib';

/**
 * 정산 계좌 등록 여부와 조회 상태.
 * - loading: 조회 중이거나 가게·토큰이 아직 없어요.
 * - registered: 저장된 계좌가 있어요.
 * - missing: 조회에 성공했고 저장된 계좌가 없어요.
 * - error: 조회에 실패했거나 응답을 읽지 못했어요(등록 여부를 알 수 없어요).
 */
export type PayoutAccountStatus = 'loading' | 'registered' | 'missing' | 'error';

/** 가게별로 기억하는 마지막 조회 결과. */
export interface PayoutAccountStatusResult {
  storeId: string;
  status: Exclude<PayoutAccountStatus, 'loading'>;
}

/**
 * `GET /stores/:storeId/payout-account` 응답(`{ account: 계좌 | null }`)을 등록 여부로 바꾼다.
 * `account: null`만 미등록으로 보고, 모양이 다른 응답은 미등록으로 단정하지 않고 error로 둔다.
 */
export function readPayoutAccountRegistration(body: unknown): PayoutAccountStatusResult['status'] {
  if (typeof body !== 'object' || body === null || !('account' in body)) return 'error';
  if ((body as { account: unknown }).account === null) return 'missing';
  return readMaskedPayoutAccount(body) ? 'registered' : 'error';
}

/** 다른 가게의 이전 결과는 쓰지 않고, 결과가 없으면 조회 중으로 본다. */
export function resolvePayoutAccountStatus(
  result: PayoutAccountStatusResult | null,
  storeId: string | null | undefined,
): PayoutAccountStatus {
  if (!result || !storeId || result.storeId !== storeId) return 'loading';
  return result.status;
}
