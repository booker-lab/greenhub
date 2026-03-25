import { IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

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
  @IsEnum(['latest', 'popular', 'price_asc', 'price_desc'])
  sort?: string;

  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  isActive?: boolean;
}
