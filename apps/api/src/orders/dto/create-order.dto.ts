import {
  GIFT_MESSAGE_MAX_LENGTH,
  ORDER_REQUEST_NOTE_MAX_LENGTH,
  PACKAGE_LABEL_MAX_LENGTH,
  PRODUCT_OPTION_GROUP_MAX,
} from '@greenhub/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// 주문 입력 상한(요청 형태 검증). 실제 판매 한도(품목별 saleLimitQuantity, 회차 maxItemQuantity,
// 공동구매 maxPerPerson)는 서비스 레이어가 검증한다. 상한은 정상 주문을 막지 않도록 넉넉히 잡는다.
// - 품목당 수량 999: 상품 상세 수량 선택 최대 99, 회차 기본 품목 한도 10·회차 수량 한도 30보다 크다.
// - 회차 주문 품목 수 50: 한 회차·한 매장 상품만 담기고 같은 품목은 중복될 수 없다.
export const ORDER_ITEM_MAX_QUANTITY = 999;
export const ROUND_ORDER_MAX_ITEMS = 50;
// 배송지·유입 태그 길이 상한. 도로명 주소는 100자 안팎이고, 유입 태그는 consumer가 128자로 자른다.
export const DELIVERY_ADDRESS_MAX_LENGTH = 200;
export const DELIVERY_ADDRESS_DETAIL_MAX_LENGTH = 100;
export const DELIVERY_ZIP_CODE_MAX_LENGTH = 10;
export const ACQUISITION_TAG_MAX_LENGTH = 128;
// 문서 ID로 경로를 만드는 식별자. '/'가 들어가면 Firestore 경로가 깨져 500이 나므로 형식으로 막는다.
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DOCUMENT_ID_MESSAGE = '식별자 형식이 올바르지 않습니다.';

class DeliveryAddressDto {
  @IsString()
  @MaxLength(DELIVERY_ADDRESS_MAX_LENGTH)
  address: string;

  @IsString()
  @MaxLength(DELIVERY_ADDRESS_DETAIL_MAX_LENGTH)
  addressDetail: string;

  @IsString()
  @MaxLength(DELIVERY_ZIP_CODE_MAX_LENGTH)
  zipCode: string;
}

class GroupBuyConsentDto {
  @IsBoolean()
  agreed: boolean;

  @IsISO8601()
  agreedAt: string;
}

class RoundOrderItemDto {
  @IsString()
  @Matches(DOCUMENT_ID_PATTERN, { message: DOCUMENT_ID_MESSAGE })
  roundItemId: string;

  @IsInt()
  @Min(1)
  @Max(ORDER_ITEM_MAX_QUANTITY)
  quantity: number;

  // 옵션 시트(벤치마킹 비교 기능): 옵션 묶음마다 고른 선택지 id. 없으면 기존 주문과 같다.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_OPTION_GROUP_MAX)
  @Matches(/^[A-Za-z0-9_-]{1,40}$/, { each: true, message: DOCUMENT_ID_MESSAGE })
  optionChoiceIds?: string[];

  // 옛 앱 호환(2026-10-30 전 옵션 시트의 상품별 문구). 받기만 하고 쓰지 않는다.
  // 자유 문구는 주문의 packageLabel로 받는다.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  optionText?: string;
}

// 선물하기(벤치마킹 비교 기능)
class GiftDto {
  @IsString()
  @MaxLength(20)
  recipientName: string;

  // 받는 분 휴대폰. 형식은 서비스(normalizeGift)가 확인한다.
  @IsString()
  @MaxLength(20)
  recipientPhone: string;

  @IsString()
  @MaxLength(20)
  senderName: string;

  @IsString()
  @MaxLength(GIFT_MESSAGE_MAX_LENGTH)
  cardMessage: string;
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
  @MaxLength(ACQUISITION_TAG_MAX_LENGTH)
  campaign?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(ACQUISITION_TAG_MAX_LENGTH)
  content?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  landingUrl?: string | null;

  @IsISO8601()
  capturedAt: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{8,128}$/, {
    message: 'clientOrderRequestId는 8~128자의 안전한 식별자여야 합니다.',
  })
  clientOrderRequestId?: string;

  @IsString()
  @Matches(DOCUMENT_ID_PATTERN, { message: DOCUMENT_ID_MESSAGE })
  productId: string;

  @IsInt()
  @Min(1)
  @Max(ORDER_ITEM_MAX_QUANTITY)
  quantity: number; // 공동구매: maxPerPerson 초과 여부는 서비스 레이어에서 검증

  @IsEnum(['normal', 'group'])
  saleType: string;

  @IsEnum(['direct', 'hub', 'parcel'])
  deliveryMethod: string;

  @IsOptional()
  @IsString()
  @Matches(DOCUMENT_ID_PATTERN, { message: DOCUMENT_ID_MESSAGE })
  hubId?: string; // deliveryMethod === 'hub' 시 필수 (서비스 레이어에서 검증)

  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress: DeliveryAddressDto;

  @IsString()
  @Matches(/^[0-9+\-\s()]{8,20}$/, {
    message: 'deliveryPhone은 유효한 전화번호 형식이어야 합니다.',
  })
  deliveryPhone: string;

  // 회차 주문 요청사항(배송 요청 등). 일반 주문은 저장하지 않는다.
  @IsOptional()
  @IsString()
  @MaxLength(ORDER_REQUEST_NOTE_MAX_LENGTH)
  requestNote?: string;

  // 일반 주문(슬롯 검증 대상)에서만 필수 — 택배·공동구매는 옵셔널
  @ValidateIf((o) => o.saleType === 'normal' && o.deliveryMethod !== 'parcel')
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'requestedDeliveryDate는 YYYY-MM-DD 형식이어야 합니다.',
  })
  requestedDeliveryDate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GroupBuyConsentDto)
  groupBuyConsent?: GroupBuyConsentDto;

  @IsOptional()
  @IsString()
  @Matches(DOCUMENT_ID_PATTERN, { message: DOCUMENT_ID_MESSAGE })
  roundId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ROUND_ORDER_MAX_ITEMS)
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

  @IsOptional()
  @ValidateNested()
  @Type(() => GiftDto)
  gift?: GiftDto;

  // 포장 겉면 라벨 문구(회차 주문, 무료). 선물이면 보내지 않는다. 한 줄 정리 뒤 길이는 서비스에서 다시 잰다.
  @IsOptional()
  @IsString()
  @MaxLength(PACKAGE_LABEL_MAX_LENGTH * 2)
  packageLabel?: string;
}
