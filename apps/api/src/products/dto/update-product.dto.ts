import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsProductImageUrl } from '../validators/product-image-url';
import {
  ContentDto,
  GroupConfigDto,
  PRODUCT_IMAGES_MAX,
  PRODUCT_MONEY_MAX,
  SelectionDto,
} from './create-product.dto';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_IMAGES_MAX)
  @IsProductImageUrl({ each: true })
  images?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRODUCT_MONEY_MAX)
  price?: number;

  @IsOptional()
  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category?: string;

  @IsOptional()
  @IsEnum(['normal', 'group'])
  saleType?: string;

  @IsOptional()
  @IsEnum(['small', 'medium', 'large'])
  deliverySize?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  varietyId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SelectionDto)
  selection?: SelectionDto;

  @IsOptional()
  @IsString()
  sellerNote?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContentDto)
  content?: ContentDto;

  @IsOptional()
  @IsBoolean()
  sellerOverride?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => GroupConfigDto)
  groupConfig?: GroupConfigDto;
}
