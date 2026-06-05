import {
  BANNER_KINDS,
  type BannerKind,
  type OrderStatus,
  SETTLEMENT_STATUSES,
  type SettlementStatus,
} from '@greenhub/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const ORDER_STATUSES = [
  'PENDING',
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REVIEWED',
] satisfies OrderStatus[];

const ADMIN_ORDER_SORTS = ['createdAt_desc', 'createdAt_asc'] as const;
const ADMIN_DRIVER_SORTS = ['createdAt_desc', 'createdAt_asc'] as const;

export class QueryAdminSettlementsDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsIn(SETTLEMENT_STATUSES)
  status?: SettlementStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class BulkPaySettlementsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids: string[];
}

export class QueryAdminOrdersDto {
  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsIn(ADMIN_ORDER_SORTS)
  sort?: (typeof ADMIN_ORDER_SORTS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;
}

export class SuspendUserDto {
  @IsBoolean()
  suspended: boolean;
}

export class SetCommissionDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  rate: number;
}

export class SetDefaultCommissionDto extends SetCommissionDto {}

export class ForceRefundDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateOrderTrackingDto {
  @IsString()
  courierCompany: string;

  @IsString()
  trackingNumber: string;
}

export class QueryAdminDriversDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'suspended'])
  status?: 'pending' | 'approved' | 'suspended';

  @IsOptional()
  @IsIn(ADMIN_DRIVER_SORTS)
  sort?: (typeof ADMIN_DRIVER_SORTS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class QueryAdminInvitesDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class GenerateInviteDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

export class BannerCtaDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  href?: string;
}

export class UpsertBannerDto {
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  tagText?: string;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
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

export class CreateBannerDto extends UpsertBannerDto {
  @IsIn(BANNER_KINDS)
  kind: BannerKind;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class UpdateBannerDto extends UpsertBannerDto {
  @IsOptional()
  @IsIn(BANNER_KINDS)
  kind?: BannerKind;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
