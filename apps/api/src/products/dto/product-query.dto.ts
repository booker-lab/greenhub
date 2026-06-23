import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

export class ProductQueryDto {
  @IsOptional()
  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category?: string;

  @IsOptional()
  colors?: string | string[];

  @IsOptional()
  @IsEnum(['normal', 'group'])
  saleType?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @IsOptional()
  @IsEnum(['direct', 'hub', 'parcel'])
  deliveryMethod?: string;

  @IsOptional()
  @IsEnum(['latest', 'popular', 'price_asc', 'price_desc'])
  sort?: string;

  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  isActive?: boolean;
}
