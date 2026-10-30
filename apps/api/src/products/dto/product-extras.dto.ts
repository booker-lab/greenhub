import {
  LIGHT_LEVELS,
  PLACEMENTS,
  PRODUCT_NOTICE_FIELDS,
  PRODUCT_OPTION_CHOICE_MAX,
  PRODUCT_OPTION_GROUP_MAX,
  PRODUCT_OPTION_PRICE_DELTA_MAX,
  type ProductNotice,
} from '@greenhub/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OPTION_STOCK_ID_PATTERN } from '../../option-stocks/option-stock.fields';

// 팔도감 벤치마킹 비교용 상품 추가 정보(packages/shared benchmark.types.ts ProductExtras).
// 모두 선택이며, 없으면 기존 상품과 같다.

const OPTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const CARE_TEXT_MAX = 120;
const ALIAS_MAX_LENGTH = 30;
const NOTICE_MAX_LENGTH = Object.fromEntries(
  PRODUCT_NOTICE_FIELDS.map((field) => [field.key, field.maxLength]),
) as Record<keyof ProductNotice, number>;

export class ProductSizeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  heightCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  widthCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  potDiameterCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  bloomCount?: number;
}

export class CareGuideDto {
  @IsString()
  @MaxLength(CARE_TEXT_MAX)
  watering: string;

  @IsString()
  @MaxLength(CARE_TEXT_MAX)
  light: string;

  @IsString()
  @MaxLength(CARE_TEXT_MAX)
  temperature: string;

  @IsString()
  @MaxLength(CARE_TEXT_MAX)
  repotting: string;
}

export class ProductOptionChoiceDto {
  @Matches(OPTION_ID_PATTERN, { message: '옵션 선택지 id 형식이 올바르지 않습니다.' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  label: string;

  @IsInt()
  @Min(0)
  @Max(PRODUCT_OPTION_PRICE_DELTA_MAX)
  priceDelta: number;

  /** 이 선택지가 쓰는 매장 옵션 재고 품목 id(직접 출력한 화분 등). 없으면 수량 제한이 없다. */
  @IsOptional()
  @Matches(OPTION_STOCK_ID_PATTERN, { message: '옵션 재고 품목 id 형식이 올바르지 않습니다.' })
  stockId?: string;
}

export class ProductOptionGroupDto {
  @Matches(OPTION_ID_PATTERN, { message: '옵션 묶음 id 형식이 올바르지 않습니다.' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRODUCT_OPTION_CHOICE_MAX)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionChoiceDto)
  choices: ProductOptionChoiceDto[];
}

/** 상품정보제공고시. 빈 칸은 화면이 기본값으로 채우므로 모두 선택이다. */
export class ProductNoticeDto {
  @IsOptional()
  @IsString()
  @MaxLength(NOTICE_MAX_LENGTH.itemName)
  itemName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTICE_MAX_LENGTH.origin)
  origin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTICE_MAX_LENGTH.producer)
  producer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTICE_MAX_LENGTH.certification)
  certification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTICE_MAX_LENGTH.csPhone)
  csPhone?: string;
}

/** Create/UpdateProductDto가 상속한다. */
export class ProductExtrasDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductSizeDto)
  size?: ProductSizeDto;

  @IsOptional()
  @IsEnum(LIGHT_LEVELS)
  light?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLACEMENTS.length)
  @IsEnum(PLACEMENTS, { each: true })
  placements?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CareGuideDto)
  careGuide?: CareGuideDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_OPTION_GROUP_MAX)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionGroupDto)
  options?: ProductOptionGroupDto[];

  @IsOptional()
  @IsBoolean()
  guaranteed?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(ALIAS_MAX_LENGTH, { each: true })
  aliases?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductNoticeDto)
  notice?: ProductNoticeDto;
}

/** 옵션 묶음·선택지 id가 상품 안에서 겹치지 않는지 확인한다. 문제가 있으면 메시지를 돌려준다. */
export function findProductOptionIdConflict(
  options: ReadonlyArray<{ id: string; choices: ReadonlyArray<{ id: string }> }> | undefined,
): string | null {
  if (!options) return null;
  const groupIds = new Set<string>();
  for (const group of options) {
    if (groupIds.has(group.id)) return `옵션 묶음 id가 겹칩니다: ${group.id}`;
    groupIds.add(group.id);
    const choiceIds = new Set<string>();
    for (const choice of group.choices) {
      if (choiceIds.has(choice.id)) return `옵션 선택지 id가 겹칩니다: ${group.id}/${choice.id}`;
      choiceIds.add(choice.id);
    }
  }
  return null;
}
