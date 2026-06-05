import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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
  quantity: number; // 공동구매: maxPerPerson 초과 여부는 서비스 레이어에서 검증

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

  // 일반 주문(슬롯 검증 대상)에서만 필수 — 택배·공동구매는 옵셔널
  @ValidateIf((o) => o.saleType === 'normal' && o.deliveryMethod !== 'parcel')
  @IsDefined({ message: 'requestedDeliveryDate가 필요합니다.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'requestedDeliveryDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  requestedDeliveryDate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GroupBuyConsentDto)
  groupBuyConsent?: GroupBuyConsentDto;
}
