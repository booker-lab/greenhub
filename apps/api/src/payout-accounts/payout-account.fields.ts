import type { FirestoreService } from '../firestore/firestore.service';

/**
 * 판매자 정산 계좌(결정 ⑤). 문서 ID = storeId. 클라이언트 직접 접근은 firestore.rules 기본 거부로 막고
 * API만 읽고 쓴다. 판매자 본인·관리자만 다루며, 판매자에게는 계좌번호 끝 4자리 외를 가려 보인다.
 */
export const STORE_PAYOUT_ACCOUNTS_COLLECTION = 'storePayoutAccounts';

export interface PayoutAccount {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
}

/** 판매자 화면용 — 계좌번호는 가린 값과 끝 4자리만 보낸다. */
export interface MaskedPayoutAccount {
  bankName: string;
  accountHolder: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
  updatedAt: unknown;
}

export function accountNumberLast4(accountNumber: string): string {
  return accountNumber.replace(/\D/g, '').slice(-4);
}

/** 끝 4자리 숫자만 남기고 나머지 숫자를 *로 가린다(하이픈 자리는 그대로). */
export function maskAccountNumber(accountNumber: string): string {
  const totalDigits = accountNumber.replace(/\D/g, '').length;
  let seen = 0;
  return accountNumber.replace(/\d/g, (digit) => {
    seen += 1;
    return seen > totalDigits - 4 ? digit : '*';
  });
}

/** 저장 문서에서 허용 필드만 읽는다. 형식이 맞지 않으면 null. */
export function readPayoutAccount(data: unknown): PayoutAccount | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const { bankName, accountHolder, accountNumber } = record;
  if (
    typeof bankName !== 'string' ||
    typeof accountHolder !== 'string' ||
    typeof accountNumber !== 'string'
  ) {
    return null;
  }
  return { bankName, accountHolder, accountNumber };
}

export function toMaskedPayoutAccount(data: unknown): MaskedPayoutAccount | null {
  const account = readPayoutAccount(data);
  if (!account) return null;
  return {
    bankName: account.bankName,
    accountHolder: account.accountHolder,
    accountNumberMasked: maskAccountNumber(account.accountNumber),
    accountNumberLast4: accountNumberLast4(account.accountNumber),
    updatedAt: (data as Record<string, unknown>)['updatedAt'] ?? null,
  };
}

/** 여러 가게의 정산 계좌를 읽는다(관리자 정산 지급용). 없는 가게는 결과에 넣지 않는다. */
export async function readPayoutAccounts(
  firestore: Pick<FirestoreService, 'doc'>,
  storeIds: readonly string[],
): Promise<Map<string, PayoutAccount>> {
  const unique = [...new Set(storeIds.filter((id) => typeof id === 'string' && id.length > 0))];
  const snaps = await Promise.all(
    unique.map((storeId) =>
      firestore.doc(`${STORE_PAYOUT_ACCOUNTS_COLLECTION}/${storeId}`).get(),
    ),
  );
  const accounts = new Map<string, PayoutAccount>();
  snaps.forEach((snap, index) => {
    const account = snap.exists ? readPayoutAccount(snap.data()) : null;
    if (account) accounts.set(unique[index], account);
  });
  return accounts;
}
