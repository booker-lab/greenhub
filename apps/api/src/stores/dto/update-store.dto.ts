import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateStoreDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  ceoName?: string;

  @IsString()
  @Matches(/^\d{2,3}-\d{3,4}-\d{4}$/, {
    message: 'phone 형식이 올바르지 않습니다 (예: 010-1234-5678)',
  })
  @IsOptional()
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  address?: string;

  @IsString()
  @Matches(/^\d{3}-\d{2}-\d{5}$/, {
    message: 'businessNumber 형식이 올바르지 않습니다 (예: 000-00-00000)',
  })
  @IsOptional()
  businessNumber?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;
}
