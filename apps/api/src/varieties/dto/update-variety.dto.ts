import { IsString, IsEnum, IsBoolean, IsArray, IsOptional } from 'class-validator';
import { COLOR_OPTIONS, type ColorOption, type FlowerSize, type PlantSize, type StemType } from '@greenhub/shared';

export class UpdateVarietyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category?: string;

  @IsOptional()
  @IsString()
  subCategory?: string;

  @IsOptional()
  @IsEnum(['small', 'medium', 'large'])
  flowerSize?: FlowerSize;

  @IsOptional()
  @IsEnum(['small', 'medium', 'large'])
  plantSize?: PlantSize;

  @IsOptional()
  @IsArray()
  @IsEnum(['외대', '쌍대', '가지', '3대'], { each: true })
  availableStemTypes?: StemType[];

  @IsOptional()
  @IsBoolean()
  hasFragrance?: boolean;

  @IsOptional()
  @IsEnum(['none', 'light', 'strong'])
  fragranceLevel?: string;

  @IsOptional()
  @IsString()
  bloomDuration?: string;

  @IsOptional()
  @IsEnum(['easy', 'normal', 'hard'])
  careLevel?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(COLOR_OPTIONS, { each: true })
  typicalColors?: ColorOption[];

  @IsOptional()
  @IsString()
  notes?: string;
}
