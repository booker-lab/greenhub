import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
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

export class DeliveryHoldDto {
  @IsEnum(DELIVERY_HOLD_REASONS)
  reasonCode: (typeof DELIVERY_HOLD_REASONS)[number];

  @IsString()
  reasonMessage: string;

  @IsBoolean()
  customerResponsible: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
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
