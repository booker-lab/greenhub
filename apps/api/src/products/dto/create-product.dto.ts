import {
  IsString,
  IsNumber,
  IsEnum,
  IsArray,
  IsBoolean,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GroupConfigDto {
  @IsNumber()
  @Min(2)
  minParticipants: number;

  @IsNumber()
  maxParticipants: number;

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

  @IsEnum(['none', 'light', 'strong'])
  fragrance: string;

  @IsEnum(['bud', 'half', 'full'])
  bloomCondition: string;

  @IsString()
  bundleUnit: string;
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
  @IsString({ each: true })
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
