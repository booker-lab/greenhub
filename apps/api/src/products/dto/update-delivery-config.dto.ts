import { IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class UpdateDeliveryConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  directFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hubFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  parcelFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  freeThresholdDirect?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  freeThresholdHub?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  freeThresholdParcel?: number;

  @IsOptional()
  @IsBoolean()
  weatherRestrictionActive?: boolean;
}
