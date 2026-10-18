import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// 팔도감 벤치마킹 비교용 판매자 공개 소개(packages/shared benchmark.types.ts StoreProfileExtras).

export class StoreGuaranteeDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MaxLength(40)
  title: string;

  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  terms: string[];
}

export class StoreProfileExtrasDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  intro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  story?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  region?: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  sinceYear?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoreGuaranteeDto)
  guarantee?: StoreGuaranteeDto;

  @IsOptional()
  @IsBoolean()
  showDemandSignals?: boolean;
}

export const STORE_PROFILE_EXTRA_FIELDS = [
  'intro',
  'story',
  'region',
  'sinceYear',
  'guarantee',
  'showDemandSignals',
] as const;

/** 저장된 매장 문서에서 공개 소개 필드만 고른다(값이 있는 것만). */
export function pickStoreProfileExtras(data: Record<string, unknown>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const key of STORE_PROFILE_EXTRA_FIELDS) {
    if (data[key] !== undefined && data[key] !== null) extras[key] = data[key];
  }
  return extras;
}
