import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** 매장 주문 목록에서 거를 수 있는 주문 상태. 조회 서비스의 허용 목록과 같다. */
export const STORE_ORDER_QUERY_STATUSES = [
  'PENDING',
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'DELIVERY_HELD',
  'CANCELLED',
  'REVIEWED',
] as const;

export const STORE_ORDER_QUERY_SALE_TYPES = ['normal', 'group'] as const;

/**
 * 전화 검색어 형식. 숫자 자릿수(4~20)는 조회 서비스가 판정하고, 여기서는 판매자 화면이
 * 보낼 수 있는 문자(숫자·공백·하이픈·괄호·+·.)와 길이만 막는다.
 */
const PHONE_SEARCH_MAX_LENGTH = 32;
const PHONE_SEARCH_PATTERN = /^[\d\s\-+().]+$/;

/** GET /stores/:storeId/orders 쿼리. */
export class QueryStoreOrdersDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  userId?: string;

  @IsOptional()
  @IsIn(STORE_ORDER_QUERY_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(STORE_ORDER_QUERY_SALE_TYPES)
  saleType?: string;

  /**
   * @deprecated 전화 검색은 POST /stores/:storeId/orders/phone-search 본문으로 보낸다.
   * API와 판매자 앱이 따로 배포되는 동안의 호환을 위해서만 남긴다.
   */
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_SEARCH_MAX_LENGTH)
  @Matches(PHONE_SEARCH_PATTERN)
  phone?: string;
}

/** POST /stores/:storeId/orders/phone-search 본문. 전화번호를 URL에 싣지 않기 위한 경로다. */
export class SearchStoreOrdersByPhoneDto {
  @IsString()
  @MaxLength(PHONE_SEARCH_MAX_LENGTH)
  @Matches(PHONE_SEARCH_PATTERN)
  phone: string;
}
