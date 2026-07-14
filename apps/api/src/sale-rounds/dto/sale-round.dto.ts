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

class SaleRoundScheduleDto {
  @IsISO8601()
  orderOpenAt: string;

  @IsISO8601()
  orderCloseAt: string;

  @IsISO8601()
  auctionAt: string;

  @IsISO8601()
  deliveryStartAt: string;

  @IsISO8601()
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
