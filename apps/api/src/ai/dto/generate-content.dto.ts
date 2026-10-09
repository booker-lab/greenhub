import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { COLOR_OPTIONS, type ColorOption } from '@greenhub/shared';

export const SELLER_NOTE_MAX_LENGTH = 1000;
export const BUNDLE_UNIT_MAX_LENGTH = 50;
export const VARIETY_ID_MAX_LENGTH = 128;

export class SelectionDto {
  @IsArray()
  @ArrayMaxSize(COLOR_OPTIONS.length)
  @IsEnum(COLOR_OPTIONS, { each: true })
  colors: ColorOption[];

  @IsEnum(['외대', '쌍대', '가지', '3대'])
  stemType: string;

  @IsEnum(['none', 'light', 'strong'])
  fragrance: string;

  @IsEnum(['bud', 'half', 'full'])
  bloomCondition: string;

  @IsString()
  @MaxLength(BUNDLE_UNIT_MAX_LENGTH)
  bundleUnit: string;

  @IsOptional()
  @IsEnum(['easy', 'normal', 'hard'])
  careLevel?: string;
}

export class GenerateContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(VARIETY_ID_MAX_LENGTH)
  varietyId?: string;

  @IsOptional()
  @IsEnum(['orchid', 'cut_flower', 'foliage'])
  category?: string;

  @ValidateNested()
  @Type(() => SelectionDto)
  selection: SelectionDto;

  @IsOptional()
  @IsString()
  @MaxLength(SELLER_NOTE_MAX_LENGTH)
  sellerNote?: string;
}
