import { IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { COLOR_OPTIONS, type ColorOption } from '@greenhub/shared';

export class ProductQueryDto {
  @IsOptional()
  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean);
  })
  @IsEnum(COLOR_OPTIONS, { each: true })
  colors?: ColorOption[];

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
