import { IsString, Matches, MaxLength } from 'class-validator';

export const PAYOUT_BANK_NAME_MAX_LENGTH = 20;
export const PAYOUT_ACCOUNT_HOLDER_MAX_LENGTH = 30;
export const PAYOUT_ACCOUNT_NUMBER_MAX_LENGTH = 30;

/** 은행 이름: 한글·영문·숫자·공백·괄호 2~20자(예: 국민은행, 농협(단위), SC제일은행). */
export const PAYOUT_BANK_NAME_PATTERN = /^[가-힣A-Za-z0-9 ()]{2,20}$/;

/**
 * 계좌번호: 숫자와 숫자 사이 하이픈만 받는다. 숫자는 8~20자리.
 * 예: 110-123-456789, 3333012345678.
 */
export const PAYOUT_ACCOUNT_NUMBER_PATTERN = /^(?=(?:-?\d){8,20}$)\d+(?:-\d+)*$/;

/** 판매자 정산 계좌 저장 본문. 서버가 앞뒤 공백을 지워 저장한다. */
export class UpsertPayoutAccountDto {
  @IsString()
  @MaxLength(PAYOUT_BANK_NAME_MAX_LENGTH)
  @Matches(PAYOUT_BANK_NAME_PATTERN, {
    message: '은행 이름은 한글·영문·숫자 2~20자로 입력하세요.',
  })
  bankName!: string;

  @IsString()
  @MaxLength(PAYOUT_ACCOUNT_HOLDER_MAX_LENGTH)
  @Matches(/\S/, { message: '예금주를 입력하세요.' })
  @Matches(/^\P{Cc}*$/u, { message: '예금주에는 줄바꿈이나 제어문자를 쓸 수 없습니다.' })
  accountHolder!: string;

  @IsString()
  @MaxLength(PAYOUT_ACCOUNT_NUMBER_MAX_LENGTH)
  @Matches(PAYOUT_ACCOUNT_NUMBER_PATTERN, {
    message: '계좌번호는 숫자와 하이픈(-)으로 8~20자리를 입력하세요.',
  })
  accountNumber!: string;
}
