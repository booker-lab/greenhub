import { FLOWER_MARKET_GUBNS, MARKET_NAME_MAX_LENGTH, MARKET_UNITS_PER_ITEM_MAX } from '@greenhub/shared';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

// 경매 이름은 수집한 이름 그대로 고른다. 앞뒤 공백·줄바꿈·제어문자는 받지 않는다.
const MARKET_NAME_PATTERN = /^[^\s\p{Cc}](?:[^\p{Cc}]*[^\s\p{Cc}])?$/u;
const MARKET_NAME_MESSAGE = '경매 품목·품종·등급 이름 형식이 올바르지 않습니다.';

/** 상품이 따를 경매 시세(상품 저장 본문). */
export class ProductMarketRefDto {
  @IsIn(FLOWER_MARKET_GUBNS)
  flowerGubn: number;

  @IsString()
  @MaxLength(MARKET_NAME_MAX_LENGTH)
  @Matches(MARKET_NAME_PATTERN, { message: MARKET_NAME_MESSAGE })
  pumName: string;

  @IsOptional()
  @IsString()
  @MaxLength(MARKET_NAME_MAX_LENGTH)
  @Matches(MARKET_NAME_PATTERN, { message: MARKET_NAME_MESSAGE })
  goodName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MARKET_NAME_MAX_LENGTH)
  @Matches(MARKET_NAME_PATTERN, { message: MARKET_NAME_MESSAGE })
  grade?: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MARKET_UNITS_PER_ITEM_MAX)
  unitsPerItem: number;
}

const GUBN_TEXT = new RegExp(`^(${FLOWER_MARKET_GUBNS.join('|')})$`);

/** 쿼리 문자열은 그대로 오므로(전역 ValidationPipe가 변환하지 않는다) 문자열 모양으로 검사한다. */
export class MarketCatalogQueryDto {
  @Matches(GUBN_TEXT, { message: '부류 코드가 올바르지 않습니다.' })
  flowerGubn: string;
}

export class MarketLookupQueryDto extends MarketCatalogQueryDto {
  @IsString()
  @MaxLength(MARKET_NAME_MAX_LENGTH)
  @Matches(MARKET_NAME_PATTERN, { message: MARKET_NAME_MESSAGE })
  pumName: string;

  @IsOptional()
  @IsString()
  @MaxLength(MARKET_NAME_MAX_LENGTH)
  @Matches(MARKET_NAME_PATTERN, { message: MARKET_NAME_MESSAGE })
  goodName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MARKET_NAME_MAX_LENGTH)
  @Matches(MARKET_NAME_PATTERN, { message: MARKET_NAME_MESSAGE })
  grade?: string;

  @IsOptional()
  @Matches(/^(?:\d{1,3})(?:\.\d{1,2})?$/, { message: '상품 1개당 경매 단위 수 형식이 올바르지 않습니다.' })
  unitsPerItem?: string;
}

export class MarketSummariesQueryDto {
  /** 쉼표로 이은 상품 id(최대 50개). */
  @Matches(/^[A-Za-z0-9_-]{1,64}(,[A-Za-z0-9_-]{1,64}){0,49}$/, { message: '상품 id 목록 형식이 올바르지 않습니다.' })
  productIds: string;
}
