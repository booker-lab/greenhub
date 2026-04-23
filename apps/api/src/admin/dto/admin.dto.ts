import { IsOptional, IsString, IsBoolean, IsNumber, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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
}

export class QueryAdminOrdersDto {
  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  status?: string;
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

export class ForceRefundDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class QueryAdminDriversDto {
  @IsOptional()
  @IsString()
  status?: 'pending' | 'approved' | 'suspended';
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
}
