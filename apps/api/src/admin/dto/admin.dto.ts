import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  Matches,
  MaxLength,
  Min,
  Max,
  ValidateBy,
  ValidateNested,
  isURL,
  type ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SETTLEMENT_STATUSES, type SettlementStatus } from '@greenhub/shared';
import { ORDER_STATUSES, type OrderStatus } from '../../orders/dto/update-status.dto';

// 기간 필터는 KST 달력 날짜(YYYY-MM-DD)만 받는다. 형식·날짜가 틀리면 400으로 거부한다.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ONLY_MESSAGE = '날짜는 YYYY-MM-DD 형식이어야 합니다.';

export const ADMIN_DRIVER_STATUS_FILTERS = ['pending', 'approved', 'suspended'] as const;

export const ADMIN_REFUND_REASON_MAX_LENGTH = 500;
export const BANNER_URL_MAX_LENGTH = 2048;
export const BANNER_TAG_TEXT_MAX_LENGTH = 50;
export const BANNER_HEADLINE_MAX_LENGTH = 100;
export const BANNER_SUB_TEXT_MAX_LENGTH = 300;
export const BANNER_CTA_LABEL_MAX_LENGTH = 30;

function isHttpsUrl(value: string): boolean {
  return isURL(value, { protocols: ['https'], require_protocol: true });
}

// 빈 문자열은 "지정 안 함"(화면 기본값)으로 허용하고, 값이 있으면 https 주소만 받는다.
function IsOptionalHttpsUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isOptionalHttpsUrl',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && (value === '' || isHttpsUrl(value)),
        defaultMessage: () => '이미지 주소는 https 주소여야 합니다.',
      },
    },
    validationOptions,
  );
}

// 사이트 안 경로: '/'로 시작하되 '//'·'/\'(다른 사이트로 해석됨)와 공백·역슬래시는 받지 않는다.
const INTERNAL_PATH_PATTERN = /^\/(?![/\\])[^\s\\]*$/;

// 배너 링크: 빈 문자열, 사이트 안 경로, 또는 https 주소만 받는다.
function IsBannerHref(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isBannerHref',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          (value === '' || INTERNAL_PATH_PATTERN.test(value) || isHttpsUrl(value)),
        defaultMessage: () => '링크는 /로 시작하는 사이트 안 경로나 https 주소여야 합니다.',
      },
    },
    validationOptions,
  );
}

export class QueryAdminSettlementsDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: DATE_ONLY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DATE_ONLY_MESSAGE })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: DATE_ONLY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DATE_ONLY_MESSAGE })
  to?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  // 허용값은 shared 정산 status SSOT. 셀러 QuerySettlementsDto와 같은 방식으로 검증한다.
  @IsOptional()
  @IsIn(SETTLEMENT_STATUSES)
  status?: SettlementStatus;
}

export class QueryAdminOrdersDto {
  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;
}

export class SuspendUserDto {
  @IsBoolean()
  suspended: boolean;

  // 어드민 행동 기록에 남길 사유(선택). 고객 개인정보를 적지 않도록 화면에서 안내한다.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class SetCommissionDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  rate: number;
}

export class ForceRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_REFUND_REASON_MAX_LENGTH)
  reason?: string;
}

export class QueryAdminDriversDto {
  @IsOptional()
  @IsIn(ADMIN_DRIVER_STATUS_FILTERS)
  status?: (typeof ADMIN_DRIVER_STATUS_FILTERS)[number];
}

export class BannerCtaDto {
  @IsOptional()
  @IsString()
  @MaxLength(BANNER_CTA_LABEL_MAX_LENGTH)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BANNER_URL_MAX_LENGTH)
  @IsBannerHref()
  href?: string;
}

export class UpsertBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(BANNER_URL_MAX_LENGTH)
  @IsOptionalHttpsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BANNER_TAG_TEXT_MAX_LENGTH)
  tagText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BANNER_HEADLINE_MAX_LENGTH)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BANNER_SUB_TEXT_MAX_LENGTH)
  subText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BannerCtaDto)
  cta1?: BannerCtaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BannerCtaDto)
  cta2?: BannerCtaDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  updatedAt?: unknown;

  @IsOptional()
  createdAt?: unknown;
}
