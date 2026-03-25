import {
  IsString,
  IsNumber,
  IsEnum,
  IsArray,
  IsBoolean,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GroupConfigDto {
  @IsNumber()
  @Min(2)
  minParticipants: number;

  @IsNumber()
  maxParticipants: number;

  @IsString()
  recruitDeadline: string; // ISO8601

  @IsString()
  groupDeliveryDate: string; // ISO8601

  @IsEnum(['direct', 'parcel'])
  groupDeliveryMethod: string;

  @IsNumber()
  @Min(0)
  deliveryFeeDiscount: number;
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsArray()
  @IsString({ each: true })
  images: string[];

  @IsNumber()
  @Min(0)
  price: number;

  @IsEnum(['cut_flower', 'orchid', 'foliage'])
  category: string;

  @IsArray()
  @IsString({ each: true })
  colors: string[];

  @IsEnum(['normal', 'group'])
  saleType: string;

  @IsEnum(['small', 'medium', 'large'])
  deliverySize: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => GroupConfigDto)
  groupConfig?: GroupConfigDto;
}
