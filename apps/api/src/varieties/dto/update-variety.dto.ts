import { IsString, IsEnum, IsBoolean, IsArray, IsOptional } from 'class-validator';

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
  @IsString({ each: true })
  typicalColors?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
