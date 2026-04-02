import { IsEnum, IsISO8601, IsOptional, IsString, IsUrl } from 'class-validator';

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
  'REVIEWED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

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
}
