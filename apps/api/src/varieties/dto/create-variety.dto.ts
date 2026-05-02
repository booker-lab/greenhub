import { IsString, IsEnum, IsBoolean, IsArray, IsOptional } from 'class-validator';

export class CreateVarietyDto {
  @IsString()
  name: string;

  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category: string;

  @IsString()
  subCategory: string;

  @IsEnum(['small', 'medium', 'large'])
  flowerSize: string;

  @IsEnum(['small', 'medium', 'large'])
  plantSize: string;

  @IsArray()
  @IsEnum(['외대', '쌍대', '가지', '3대'], { each: true })
  availableStemTypes: string[];

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
