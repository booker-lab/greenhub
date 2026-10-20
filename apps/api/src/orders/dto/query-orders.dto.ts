import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

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
 * 진행 중 주문 상태(처리 필요·대기·배송 중). 판매자가 계속 다뤄야 하는 주문이라 기간과 상관없이 모두 준다.
 * 판매자 앱 STATUS_GROUP_MAP의 ACTION_REQUIRED·WAITING·IN_DELIVERY와 같은 범위다.
 */
export const STORE_ORDER_ACTIVE_STATUSES = [
  'PENDING',
  'RECRUITING',
  'ACCEPTED',
  'CONFIRMED',
  'DELIVERY_HELD',
  'PREPARING',
  'DELIVERING',
  'HUB_ARRIVED',
] as const;

/** 끝난 주문 상태(완료·취소). 계속 쌓이므로 최신순으로 나눠 받는다. */
export const STORE_ORDER_ARCHIVED_STATUSES = [
  'DELIVERED',
  'PICKED_UP',
  'REVIEWED',
  'CANCELLED',
] as const;

export const STORE_ORDER_QUERY_SCOPES = ['active', 'archive'] as const;

/** 회차 id·이어받기 위치(주문 id) 형식. 경로 구분자는 받지 않는다. */
export const STORE_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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

  /** active = 진행 중 주문 전부, archive = 끝난 주문을 최신순으로 limit건씩(cursor로 이어받기). */
  @IsOptional()
  @IsIn(STORE_ORDER_QUERY_SCOPES)
  scope?: string;

  /** 이 회차의 주문만 준다. */
  @IsOptional()
  @IsString()
  @Matches(STORE_ORDER_ID_PATTERN)
  roundId?: string;

  /** scope=archive 한 번에 받을 건수. 생략하면 기본값, 상한을 넘으면 상한으로 줄인다(서비스에서 처리). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  /** scope=archive 앞 응답의 nextCursor. 그 다음 주문부터 이어서 받는다. */
  @IsOptional()
  @IsString()
  @Matches(STORE_ORDER_ID_PATTERN)
  cursor?: string;

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
