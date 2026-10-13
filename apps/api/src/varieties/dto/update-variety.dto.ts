import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { COLOR_OPTIONS, type ColorOption, type FlowerSize, type PlantSize, type StemType } from '@greenhub/shared';
import {
  STEM_TYPE_VALUES,
  VARIETY_BLOOM_DURATION_MAX_LENGTH,
  VARIETY_NAME_MAX_LENGTH,
  VARIETY_NOTES_MAX_LENGTH,
  VARIETY_SUB_CATEGORY_MAX_LENGTH,
} from './create-variety.dto';

export class UpdateVarietyDto {
  @IsOptional()
  @IsString()
  @MaxLength(VARIETY_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(VARIETY_SUB_CATEGORY_MAX_LENGTH)
  subCategory?: string;

  @IsOptional()
  @IsEnum(['small', 'medium', 'large'])
  flowerSize?: FlowerSize;

  @IsOptional()
  @IsEnum(['small', 'medium', 'large'])
  plantSize?: PlantSize;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STEM_TYPE_VALUES.length)
  @IsEnum(STEM_TYPE_VALUES, { each: true })
  availableStemTypes?: StemType[];

  @IsOptional()
  @IsBoolean()
  hasFragrance?: boolean;

  @IsOptional()
  @IsEnum(['none', 'light', 'strong'])
  fragranceLevel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(VARIETY_BLOOM_DURATION_MAX_LENGTH)
  bloomDuration?: string;

  @IsOptional()
  @IsEnum(['easy', 'normal', 'hard'])
  careLevel?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(COLOR_OPTIONS.length)
  @IsEnum(COLOR_OPTIONS, { each: true })
  typicalColors?: ColorOption[];

  @IsOptional()
  @IsString()
  @MaxLength(VARIETY_NOTES_MAX_LENGTH)
  notes?: string;
}
