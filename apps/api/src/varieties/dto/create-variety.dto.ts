import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { COLOR_OPTIONS, type ColorOption, type StemType } from '@greenhub/shared';

export const VARIETY_NAME_MAX_LENGTH = 100;
export const VARIETY_SUB_CATEGORY_MAX_LENGTH = 50;
export const VARIETY_BLOOM_DURATION_MAX_LENGTH = 50;
export const VARIETY_NOTES_MAX_LENGTH = 1000;
export const STEM_TYPE_VALUES: StemType[] = ['외대', '쌍대', '가지', '3대'];

export class CreateVarietyDto {
  @IsString()
  @MaxLength(VARIETY_NAME_MAX_LENGTH)
  name: string;

  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category: string;

  @IsString()
  @MaxLength(VARIETY_SUB_CATEGORY_MAX_LENGTH)
  subCategory: string;

  @IsEnum(['small', 'medium', 'large'])
  flowerSize: string;

  @IsEnum(['small', 'medium', 'large'])
  plantSize: string;

  @IsArray()
  @ArrayMaxSize(STEM_TYPE_VALUES.length)
  @IsEnum(STEM_TYPE_VALUES, { each: true })
  availableStemTypes: StemType[];

  @IsBoolean()
  hasFragrance: boolean;

  @IsEnum(['none', 'light', 'strong'])
  fragranceLevel: string;

  @IsString()
  @MaxLength(VARIETY_BLOOM_DURATION_MAX_LENGTH)
  bloomDuration: string;

  @IsEnum(['easy', 'normal', 'hard'])
  careLevel: string;

  @IsArray()
  @ArrayMaxSize(COLOR_OPTIONS.length)
  @IsEnum(COLOR_OPTIONS, { each: true })
  typicalColors: ColorOption[];

  @IsOptional()
  @IsString()
  @MaxLength(VARIETY_NOTES_MAX_LENGTH)
  notes?: string;
}
