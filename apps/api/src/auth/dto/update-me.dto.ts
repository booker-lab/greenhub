import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// 프로필 이름은 주문의 구매자 이름과 거래 알림 본문에 들어가므로 한 줄 짧은 이름만 받는다.
export const PROFILE_NAME_MAX_LENGTH = 20;

// 제어문자(줄바꿈·탭 포함), 줄/문단 구분자, 보이지 않는 서식 문자를 포함하지 않는다.
export const PROFILE_NAME_NO_CONTROL_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 거부하기 위한 패턴이다.
  /^[^\u0000-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]*$/;

// scheme URL, www., 도메인(`<문자>.<영문>/…` 경로가 붙거나 흔한 최상위 도메인으로 끝남)을 포함하지 않는다.
// `john.doe`·`Mr.Kim`처럼 점이 들어간 이름은 받는다. 알림 본문의 이름 판정과 같은 규칙이다.
export const PROFILE_NAME_NO_LINK_PATTERN =
  /^(?![\s\S]*(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[\p{L}\p{N}-]+\.(?:[a-z]{2,}\/|(?:com|net|org|kr|co|io|me|ly|gl|to|cc|tv|us|jp|cn|app|xyz|info|biz|shop|site|top|link|online|store)(?![a-z]))))/iu;

// 전화번호 1개(숫자·공백·하이픈·괄호·+, 8~20자). 쉼표·줄바꿈 등으로 여러 번호를 이은 값은 받지 않는다.
// 주문 배송 연락처(deliveryPhone)와 같은 문자 집합이되 공백은 스페이스만 허용한다.
export const PROFILE_PHONE_PATTERN = /^[0-9+\- ()]{8,20}$/;

export const PROFILE_FIELD_MESSAGES = {
  nameMaxLength: `이름은 ${PROFILE_NAME_MAX_LENGTH}자 이하여야 합니다.`,
  nameControl: '이름에는 줄바꿈이나 제어문자를 사용할 수 없습니다.',
  nameLink: '이름에는 링크나 도메인을 포함할 수 없습니다.',
  phone: 'phone은 유효한 전화번호 형식이어야 합니다.',
} as const;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_NAME_MAX_LENGTH, { message: PROFILE_FIELD_MESSAGES.nameMaxLength })
  @Matches(PROFILE_NAME_NO_CONTROL_PATTERN, { message: PROFILE_FIELD_MESSAGES.nameControl })
  @Matches(PROFILE_NAME_NO_LINK_PATTERN, { message: PROFILE_FIELD_MESSAGES.nameLink })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(PROFILE_PHONE_PATTERN, { message: PROFILE_FIELD_MESSAGES.phone })
  phone?: string;
}
