import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

export class GenerateContentDto {
  @IsOptional()
  @IsString()
  varietyId?: string;

  @IsOptional()
  @IsEnum(['orchid', 'cut_flower', 'foliage'])
  category?: string;

  @ValidateNested()
  @Type(() => SelectionDto)
  selection: SelectionDto;

  @IsOptional()
  @IsString()
  sellerNote?: string;
}
