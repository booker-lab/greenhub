import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
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
  'DELIVERY_HELD',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const DELIVERY_HOLD_REASONS = [
  'WEATHER',
  'ACCESS_UNAVAILABLE',
  'ADDRESS_ISSUE',
  'CUSTOMER_UNREACHABLE',
  'OTHER',
] as const;

/**
 * 고객 책임 재배송비 상한(원). 매장 기본 직배송비(3,000원)의 여러 배를 넘는 금액은
 * 입력 실수로 보고 받지 않는다. KRW 결제 금액이므로 정수만 허용한다.
 */
export const MAX_REDELIVERY_FEE_KRW = 50_000;

/** 재배송비 값이 없거나(null) 0 이상 상한 이하의 정수인지 확인한다. */
export function isAllowedRedeliveryFee(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_REDELIVERY_FEE_KRW
  );
}

export class DeliveryHoldDto {
  @IsEnum(DELIVERY_HOLD_REASONS)
  reasonCode: (typeof DELIVERY_HOLD_REASONS)[number];

  @IsString()
  reasonMessage: string;

  @IsBoolean()
  customerResponsible: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_REDELIVERY_FEE_KRW)
  redeliveryFee?: number | null;

  @IsOptional()
  @IsISO8601()
  nextContactAt?: string | null;

  @IsOptional()
  @IsISO8601()
  nextDeliveryAt?: string | null;
}

export class HoldDeliveryDto {
  @ValidateNested()
  @Type(() => DeliveryHoldDto)
  deliveryHold: DeliveryHoldDto;
}

export class CreateRedeliveryFeeDto {
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AttachDeliveryPhotoDto {
  @IsUrl({ require_protocol: true })
  photoUrl: string;
}

export class UpdateStatusDto {
  @IsEnum(ORDER_STATUSES)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\r\n]*$/, {
    message: '취소 사유에는 줄바꿈이나 제어문자를 사용할 수 없습니다.',
  })
  reason?: string;

  @IsOptional()
  @IsISO8601()
  preparedAt?: string;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryHoldDto)
  deliveryHold?: DeliveryHoldDto;
}
