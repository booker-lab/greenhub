import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const COUPON_AMOUNT_MAX = 1_000_000;

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  name: string;

  @IsEnum(['amount', 'percent'])
  discountType: 'amount' | 'percent';

  @IsInt()
  @Min(1)
  @Max(COUPON_AMOUNT_MAX)
  value: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(COUPON_AMOUNT_MAX)
  maxDiscount?: number;

  @IsInt()
  @Min(0)
  @Max(COUPON_AMOUNT_MAX * 10)
  minOrderAmount: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  claimable?: boolean;
}

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  claimable?: boolean;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;
}
