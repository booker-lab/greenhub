import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  ValidateNested,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class DeliveryAddressDto {
  @IsString()
  address: string;

  @IsString()
  addressDetail: string;

  @IsString()
  zipCode: string;
}

class GroupBuyConsentDto {
  @IsBoolean()
  agreed: boolean;

  @IsString()
  agreedAt: string; // ISO8601
}

export class CreateOrderDto {
  @IsString()
  productId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsEnum(['normal', 'group'])
  saleType: string;

  @IsEnum(['direct', 'hub', 'parcel'])
  deliveryMethod: string;

  @IsOptional()
  @IsString()
  hubId?: string; // deliveryMethod === 'hub' 시 필수 (서비스 레이어에서 검증)

  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress: DeliveryAddressDto;

  @IsOptional()
  @IsString()
  requestedDeliveryDate?: string; // YYYY-MM-DD

  @IsOptional()
  @ValidateNested()
  @Type(() => GroupBuyConsentDto)
  groupBuyConsent?: GroupBuyConsentDto;
}
