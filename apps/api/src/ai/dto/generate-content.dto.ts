import { IsObject, IsOptional, IsString } from 'class-validator';

export class GenerateContentDto {
  @IsOptional()
  @IsString()
  varietyId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsObject()
  selection?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  sellerNote?: string;
}
