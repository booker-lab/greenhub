import {
  IsString,
  IsEnum,
  IsBoolean,
  IsArray,
  IsOptional,
} from 'class-validator';

export class CreateVarietyDto {
  @IsString()
  name: string;

  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category: string;

  @IsString()
  subCategory: string;

  @IsBoolean()
  hasFragrance: boolean;

  @IsEnum(['none', 'light', 'strong'])
  fragranceLevel: string;

  @IsString()
  bloomDuration: string;

  @IsEnum(['easy', 'normal', 'hard'])
  careLevel: string;

  @IsArray()
  @IsString({ each: true })
  typicalColors: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
