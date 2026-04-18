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

  @IsEnum(['none', 'light', 'strong'])
  fragrance: string;

  @IsEnum(['bud', 'half', 'full'])
  bloomCondition: string;

  @IsString()
  bundleUnit: string;
}

export class GenerateContentDto {
  @IsOptional()
  @IsString()
  varietyId?: string;

  @ValidateNested()
  @Type(() => SelectionDto)
  selection: SelectionDto;

  @IsOptional()
  @IsString()
  sellerNote?: string;
}
