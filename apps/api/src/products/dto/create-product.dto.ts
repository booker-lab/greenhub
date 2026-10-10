import { COLOR_OPTIONS, type ColorOption } from '@greenhub/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsProductImageUrl } from '../validators/product-image-url';

/** 원 단위 금액 상한(1억 원). */
export const PRODUCT_MONEY_MAX = 100_000_000;
/** 공동구매 수량 상한. */
export const GROUP_QUANTITY_MAX = 100_000;
/** 상품 이미지 개수 상한. 판매자 화면은 5장까지 올린다. */
export const PRODUCT_IMAGES_MAX = 10;

export class GroupConfigDto {
  @IsInt()
  @Min(1)
  @Max(GROUP_QUANTITY_MAX)
  minQuantity: number;

  @IsInt()
  @Min(1)
  @Max(GROUP_QUANTITY_MAX)
  targetQuantity: number;

  @IsInt()
  @Min(1)
  @Max(GROUP_QUANTITY_MAX)
  maxPerPerson: number;

  @IsISO8601({ strict: true })
  recruitDeadline: string; // ISO8601

  @IsISO8601({ strict: true })
  groupDeliveryDate: string; // ISO8601

  @IsEnum(['direct', 'parcel'])
  groupDeliveryMethod: string;

  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  deliveryFeeDiscount: number;
}

export class SelectionDto {
  @IsArray()
  @IsEnum(COLOR_OPTIONS, { each: true })
  colors: ColorOption[];

  @IsEnum(['외대', '쌍대', '가지', '3대'])
  stemType: string;

  @IsEnum(['none', 'light', 'strong'])
  fragrance: string;

  @IsEnum(['bud', 'half', 'full'])
  bloomCondition: string;

  @IsString()
  bundleUnit: string;

  @IsOptional()
  @IsEnum(['easy', 'normal', 'hard'])
  careLevel?: string;
}

export class ContentDto {
  @IsString()
  headline: string;

  @IsString()
  description: string;

  @IsBoolean()
  isEditedByUser: boolean;
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsArray()
  @ArrayMaxSize(PRODUCT_IMAGES_MAX)
  @IsProductImageUrl({ each: true })
  images: string[];

  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  price: number;

  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category: string;

  @IsEnum(['normal', 'group'])
  saleType: string;

  @IsEnum(['small', 'medium', 'large'])
  deliverySize: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // AI 시스템 필드
  @IsOptional()
  @IsString()
  varietyId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SelectionDto)
  selection?: SelectionDto;

  @IsOptional()
  @IsString()
  sellerNote?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContentDto)
  content?: ContentDto;

  @IsOptional()
  @IsBoolean()
  sellerOverride?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => GroupConfigDto)
  groupConfig?: GroupConfigDto;
}
