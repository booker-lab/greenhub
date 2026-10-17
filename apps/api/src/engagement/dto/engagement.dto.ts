import { PRODUCT_REQUEST_MAX_LENGTH, REVIEW_TEXT_MAX_LENGTH } from '@greenhub/shared';
import {
  Equals,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DOCUMENT_ID_MESSAGE = '식별자 형식이 올바르지 않습니다.';

export class CreateReviewDto {
  @IsString()
  @Matches(DOCUMENT_ID_PATTERN, { message: DOCUMENT_ID_MESSAGE })
  productId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MinLength(5, { message: '후기는 다섯 글자 이상 적어 주세요.' })
  @MaxLength(REVIEW_TEXT_MAX_LENGTH)
  text: string;
}

export class CreateProductRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_REQUEST_MAX_LENGTH)
  text: string;
}

export class CreatePartnerInquiryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  farmName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  region: string;

  /** 휴대폰 번호 또는 이메일 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^(01[016789]-?\d{3,4}-?\d{4}|[^\s@]+@[^\s@]+\.[^\s@]+)$/, {
    message: '연락처는 휴대폰 번호나 이메일로 적어 주세요.',
  })
  contact: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message: string;

  @IsBoolean()
  @Equals(true, { message: '개인정보 수집·이용에 동의해야 문의를 보낼 수 있습니다.' })
  privacyConsent: boolean;
}
