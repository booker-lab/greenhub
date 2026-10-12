import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

const SALE_ROUND_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'OPEN',
  'CLOSED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type SaleRoundStatusDtoValue = (typeof SALE_ROUND_STATUSES)[number];

// 회차 일정은 시차(Z 또는 ±hh:mm)를 반드시 담는다. 시차 없는 시각(예: 2026-10-10T18:00:00)은
// 서버 시간대(UTC)로 해석돼 Asia/Seoul 기준 9시간 늦은 일정이 저장되므로 받지 않는다.
const SCHEDULE_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const SCHEDULE_INSTANT_MESSAGE = '회차 일정 시각에는 시차(Z 또는 +09:00)가 필요합니다.';

class SaleRoundScheduleDto {
  @IsISO8601()
  @Matches(SCHEDULE_INSTANT_PATTERN, { message: SCHEDULE_INSTANT_MESSAGE })
  orderOpenAt: string;

  @IsISO8601()
  @Matches(SCHEDULE_INSTANT_PATTERN, { message: SCHEDULE_INSTANT_MESSAGE })
  orderCloseAt: string;

  @IsISO8601()
  @Matches(SCHEDULE_INSTANT_PATTERN, { message: SCHEDULE_INSTANT_MESSAGE })
  auctionAt: string;

  @IsISO8601()
  @Matches(SCHEDULE_INSTANT_PATTERN, { message: SCHEDULE_INSTANT_MESSAGE })
  deliveryStartAt: string;

  @IsISO8601()
  @Matches(SCHEDULE_INSTANT_PATTERN, { message: SCHEDULE_INSTANT_MESSAGE })
  deliveryEndAt: string;

  @IsEnum(['Asia/Seoul'])
  timezone: 'Asia/Seoul';
}

class SaleRoundDeliveryRegionDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  province: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsBoolean()
  enabled: boolean;
}

class SaleRoundLimitsDto {
  @IsInt()
  @Min(1)
  maxDeliveryAddresses: number;

  @IsInt()
  @Min(1)
  maxItemQuantity: number;
}

class SaleRoundItemInputDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  roundPrice: number;

  @IsInt()
  @Min(1)
  saleLimitQuantity: number;

  @IsInt()
  @Min(0)
  displayOrder: number;
}

export class CreateSaleRoundDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateNested()
  @Type(() => SaleRoundScheduleDto)
  schedule: SaleRoundScheduleDto;

  @ValidateNested()
  @Type(() => SaleRoundDeliveryRegionDto)
  deliveryRegion: SaleRoundDeliveryRegionDto;

  @ValidateNested()
  @Type(() => SaleRoundLimitsDto)
  limits: SaleRoundLimitsDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleRoundItemInputDto)
  items: SaleRoundItemInputDto[];

  @IsOptional()
  @IsUrl({ require_protocol: true })
  carrotLandingUrl?: string;
}

export class UpdateSaleRoundDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaleRoundScheduleDto)
  schedule?: SaleRoundScheduleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaleRoundDeliveryRegionDto)
  deliveryRegion?: SaleRoundDeliveryRegionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaleRoundLimitsDto)
  limits?: SaleRoundLimitsDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleRoundItemInputDto)
  items?: SaleRoundItemInputDto[];

  @IsOptional()
  @IsUrl({ require_protocol: true })
  carrotLandingUrl?: string;
}

export class CopySaleRoundDto {
  @IsString()
  @IsNotEmpty()
  sourceRoundId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateNested()
  @Type(() => SaleRoundScheduleDto)
  schedule: SaleRoundScheduleDto;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  carrotLandingUrl?: string;
}

export class UpdateSaleRoundStatusDto {
  @IsEnum(SALE_ROUND_STATUSES)
  status: SaleRoundStatusDtoValue;
}
