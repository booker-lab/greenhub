import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PRODUCT_MONEY_MAX } from './create-product.dto';

export class UpdateDeliveryConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  directFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  hubFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  parcelFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  freeThresholdDirect?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  freeThresholdHub?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  freeThresholdParcel?: number;

  @IsOptional()
  @IsBoolean()
  weatherRestrictionActive?: boolean;
}
