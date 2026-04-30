import {
  IsString,
  IsNumber,
  IsEnum,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';

import { Type } from 'class-transformer';

export class GroupConfigDto {
  @IsNumber()
  @Min(1)
  minQuantity: number;

  @IsNumber()
  @Min(1)
  targetQuantity: number;

  @IsNumber()
  @Min(1)
  maxPerPerson: number;

  @IsString()
  recruitDeadline: string; // ISO8601

  @IsString()
  groupDeliveryDate: string; // ISO8601

  @IsEnum(['direct', 'parcel'])
  groupDeliveryMethod: string;

  @IsNumber()
  @Min(0)
  deliveryFeeDiscount: number;
}

export class SelectionDto {
  @IsArray()
  @IsString({ each: true })
  colors: string[];

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
  @IsUrl({ require_tld: true, require_protocol: true }, { each: true })
  images: string[];

  @IsNumber()
  @Min(0)
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
