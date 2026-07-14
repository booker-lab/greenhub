import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsNumber,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUrl,
  ValidateNested,
  ValidateIf,
  IsBoolean,
  Matches,
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

class RoundOrderItemDto {
  @IsString()
  roundItemId: string;

  @IsNumber()
  @Min(1)
  quantity: number;
}

class MarketingConsentDto {
  @IsBoolean()
  agreed: boolean;

  @IsArray()
  @IsEnum(['alimtalk', 'sms'], { each: true })
  channels: Array<'alimtalk' | 'sms'>;

  @IsString()
  copyVersion: string;

  @IsOptional()
  @IsISO8601()
  agreedAt?: string;
}

class AcquisitionDto {
  @IsEnum(['carrot', 'direct', 'unknown'])
  source: 'carrot' | 'direct' | 'unknown';

  @IsOptional()
  @IsString()
  campaign?: string | null;

  @IsOptional()
  @IsString()
  content?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  landingUrl?: string | null;

  @IsISO8601()
  capturedAt: string;
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

  @IsString()
  @Matches(/^[0-9+\-\s()]{8,20}$/, { message: 'deliveryPhone은 유효한 전화번호 형식이어야 합니다.' })
  deliveryPhone: string;

  // 일반 주문(슬롯 검증 대상)에서만 필수 — 택배·공동구매는 옵셔널
  @ValidateIf((o) => o.saleType === 'normal' && o.deliveryMethod !== 'parcel')
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'requestedDeliveryDate는 YYYY-MM-DD 형식이어야 합니다.' })
  requestedDeliveryDate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GroupBuyConsentDto)
  groupBuyConsent?: GroupBuyConsentDto;

  @IsOptional()
  @IsString()
  roundId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoundOrderItemDto)
  roundItems?: RoundOrderItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MarketingConsentDto)
  marketingConsent?: MarketingConsentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AcquisitionDto)
  acquisition?: AcquisitionDto;
}
