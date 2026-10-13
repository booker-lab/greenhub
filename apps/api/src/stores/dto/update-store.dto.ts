import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { STORE_LOGO_URL_MAX_LENGTH } from '../store-logo-url';

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

  // 허용 호스트·bucket·객체 경로는 StoresService가 구성된 Firebase storage bucket으로 검사한다.
  @IsString()
  @MaxLength(STORE_LOGO_URL_MAX_LENGTH)
  @IsOptional()
  logoUrl?: string;
}
