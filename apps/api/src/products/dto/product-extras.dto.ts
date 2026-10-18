import {
  LIGHT_LEVELS,
  PLACEMENTS,
  PRODUCT_OPTION_CHOICE_MAX,
  PRODUCT_OPTION_GROUP_MAX,
  PRODUCT_OPTION_PRICE_DELTA_MAX,
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

// 팔도감 벤치마킹 비교용 상품 추가 정보(packages/shared benchmark.types.ts ProductExtras).
// 모두 선택이며, 없으면 기존 상품과 같다.

const OPTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const CARE_TEXT_MAX = 120;
const ALIAS_MAX_LENGTH = 30;

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

  /** 고객이 문구를 직접 써야 하는 선택지(스티커 라벨·3D 토퍼) */
  @IsOptional()
  @IsBoolean()
  needsText?: boolean;
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
