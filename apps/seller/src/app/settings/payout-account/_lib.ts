// 정산 계좌 화면 순수 함수. 검증 규칙은 API `UpsertPayoutAccountDto`와 같다
// (apps/api/src/payout-accounts/dto/upsert-payout-account.dto.ts). 최종 판단은 서버가 다시 한다.

export const BANK_NAME_PATTERN = /^[가-힣A-Za-z0-9 ()]{2,20}$/;
export const ACCOUNT_HOLDER_MAX_LENGTH = 30;
export const ACCOUNT_NUMBER_MAX_LENGTH = 30;
export const ACCOUNT_NUMBER_PATTERN = /^(?=(?:-?\d){8,20}$)\d+(?:-\d+)*$/;

/** 자주 쓰는 은행 이름(선택 목록). 목록에 없는 은행은 직접 입력한다. */
export const COMMON_BANKS = [
  '국민은행',
  '신한은행',
  '우리은행',
  '하나은행',
  '농협은행',
  '지역농협',
  '기업은행',
  '카카오뱅크',
  '토스뱅크',
  '케이뱅크',
  '새마을금고',
  '신협',
  '우체국',
  'SC제일은행',
  '수협은행',
  '부산은행',
  '대구은행',
  '경남은행',
  '광주은행',
  '전북은행',
  '제주은행',
] as const;

export interface PayoutAccountForm {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
}

/** 판매자 화면에 오는 저장된 계좌(계좌번호는 가려져 있다). */
export interface MaskedPayoutAccount {
  bankName: string;
  accountHolder: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
}

export function readMaskedPayoutAccount(body: unknown): MaskedPayoutAccount | null {
  if (typeof body !== 'object' || body === null) return null;
  const account = (body as Record<string, unknown>).account;
  if (typeof account !== 'object' || account === null) return null;
  const record = account as Record<string, unknown>;
  const { bankName, accountHolder, accountNumberMasked, accountNumberLast4 } = record;
  if (
    typeof bankName !== 'string' ||
    typeof accountHolder !== 'string' ||
    typeof accountNumberMasked !== 'string' ||
    typeof accountNumberLast4 !== 'string'
  ) {
    return null;
  }
  return { bankName, accountHolder, accountNumberMasked, accountNumberLast4 };
}

/** 입력을 서버로 보낼 값으로 정리한다. 틀리면 화면에 보일 문구를 돌려준다. */
export function toPayoutAccountBody(form: PayoutAccountForm): PayoutAccountForm | string {
  const bankName = form.bankName.trim();
  const accountHolder = form.accountHolder.trim();
  const accountNumber = form.accountNumber.trim();
  if (!BANK_NAME_PATTERN.test(bankName)) return '은행 이름을 확인해 주세요.';
  if (!accountHolder) return '예금주를 입력해 주세요.';
  if (accountHolder.length > ACCOUNT_HOLDER_MAX_LENGTH) return '예금주는 30자까지 쓸 수 있어요.';
  if (/\p{Cc}/u.test(accountHolder)) return '예금주에는 줄바꿈을 쓸 수 없어요.';
  if (accountNumber.length > ACCOUNT_NUMBER_MAX_LENGTH || !ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    return '계좌번호는 숫자와 하이픈(-)으로 8~20자리를 입력해 주세요.';
  }
  return { bankName, accountHolder, accountNumber };
}

/** 저장된 계좌 한 줄 표시 — 끝 4자리 외는 서버가 가린 값 그대로 쓴다. */
export function describeSavedAccount(account: MaskedPayoutAccount): string {
  return `${account.bankName} ${account.accountNumberMasked} (예금주 ${account.accountHolder})`;
}
